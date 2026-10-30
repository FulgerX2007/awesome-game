// Аншлаг — rules of the rhythm clicker. No DOM and no clock: every call takes the time in seconds, so the
// balance runs in Node with bots that tap with their own timing.
//
// Time is the audio clock as the player hears it, already corrected by the calibration offset. Beats are
// numbered from the start of the session; a grid maps beat numbers to seconds and back. A tempo change starts
// a new grid at a future beat, so beat numbers and the music already booked on the audio clock stay valid.
(function (root) {
  'use strict';
  // Russian text is the i18n key; names are translated on read, so state only ever holds ids.
  const I18n = typeof module === 'object' && module.exports ? require('../i18n.js') : root.I18n;
  const t = (key, vars) => (I18n ? I18n.t(key, vars) : key);
  function localize(o, keys) {
    for (const k of keys) {
      const raw = o[k];
      Object.defineProperty(o, k, { get: () => t(raw), enumerable: true, configurable: true });
    }
    return o;
  }

  // Seconds either side of a beat: a hit, and a perfect hit that pays PERFECT_MULT times more.
  const JUDGE = { hit: 0.12, perfect: 0.05 };
  // [streak, multiplier], highest first.
  const COMBO = [[32, 4], [16, 3], [8, 2], [4, 1.5]];
  const PERFECT_MULT = 1.25;
  const CLICK_BASE = 1;
  // A hit also pays this share of what the band earns per beat, so tapping stays worth it all game long.
  const CLICK_SHARE = 0.25;
  // Free play, for those who can't keep time: taps are not judged, one per beat pays, the multiplier stops at
  // ×1,5 and the streak resets only after `idle` seconds without a tap.
  const FREE = { cap: 1.5, idle: 2 };
  const BPM = { min: 90, step: 5, max: 180 };
  // «Разгон» raises the tempo ceiling by one step per level.
  const RUSH = { base: 300, growth: 2.6 };
  const COST_GROWTH = 1.15;
  // A musician earns twice as much at each of these levels.
  const MILESTONES = [10, 25, 50];
  const OFFLINE_MAX = 8 * 3600;

  // `beat`: coins per beat at level 1. Every musician is a layer of the music (see music.js).
  const MUSICIANS = [
    { id: 'shaker', name: 'Шейкер', base: 15, beat: 0.1, note: 'Банка с рисом шуршит на каждую восьмую.' },
    { id: 'bass', name: 'Басист', base: 150, beat: 0.8, note: 'Старый бас без двух ладов. Держит низ.' },
    { id: 'guitar', name: 'Гитарист', base: 1800, beat: 6, note: 'Бьёт по слабым долям, и всё начинает качать.' },
    { id: 'keys', name: 'Клавишник', base: 24000, beat: 40, note: 'Синтезатор на батарейках, тёплые аккорды.' },
    { id: 'sax', name: 'Саксофонист', base: 350000, beat: 250, note: 'Импровизирует: мелодия каждый раз своя.' },
  ];
  for (const m of MUSICIANS) localize(m, ['name', 'note']);
  const MUSICIAN = Object.fromEntries(MUSICIANS.map((m) => [m.id, m]));

  // ───────────── Beat grid ─────────────
  // { t0, beat0, bpm, prev }: beat `beat0` sounds at `t0`. `prev` is the grid before the last tempo change,
  // used for times before `t0`.
  function newGrid(bpm, t0) { return { t0, beat0: 0, bpm, prev: null }; }
  function beatAt(g, time) {
    if (g.prev && time < g.t0) return beatAt(g.prev, time);
    return g.beat0 + ((time - g.t0) * g.bpm) / 60;
  }
  function timeOf(g, beat) {
    if (g.prev && beat < g.beat0) return timeOf(g.prev, beat);
    return g.t0 + ((beat - g.beat0) * 60) / g.bpm;
  }
  // The same beats at another tempo, from the first whole beat at or after `from` (pass now plus what is already
  // booked on the audio clock). A change before the last one took effect just replaces it.
  function retime(g, bpm, from) {
    if (bpm === g.bpm) return g;
    const beat = Math.ceil(beatAt(g, from) - 1e-9);
    if (g.prev && beat <= g.beat0) return { t0: g.t0, beat0: g.beat0, bpm, prev: g.prev };
    return { t0: timeOf(g, beat), beat0: beat, bpm, prev: { t0: g.t0, beat0: g.beat0, bpm: g.bpm, prev: null } };
  }

  // Which beat a tap at `time` belongs to, how far off it is (seconds, + is late) and the grade.
  function judge(g, time) {
    const beat = Math.round(beatAt(g, time));
    const delta = time - timeOf(g, beat);
    const a = Math.abs(delta);
    return { beat, delta, grade: a <= JUDGE.perfect ? 'perfect' : a <= JUDGE.hit ? 'good' : 'miss' };
  }

  // ───────────── State ─────────────
  function newState() {
    return {
      v: 1, coins: 0, total: 0, levels: {}, rush: 0, bpm: BPM.min, free: false, streak: 0, best: 0,
      stats: { taps: 0, hits: 0, perfect: 0, misses: 0, beats: 0 },
      run: null, // the session: not saved, a reload starts a new one
    };
  }
  // A new session whose beat 0 sounds at t0. `hit` is the last beat that got a hit, `failed` the last beat that
  // already cost the streak, `closed` the last beat whose window is settled, `paid` the last beat the band was
  // paid for.
  function start(s, t0) {
    s.run = { grid: newGrid(s.bpm, t0), hit: -Infinity, failed: -Infinity, closed: -1, paid: -1, lastTap: -Infinity };
    s.streak = 0;
    return s.run;
  }

  // ───────────── Economy ─────────────
  const level = (s, id) => s.levels[id] || 0;
  const cost = (s, id) => Math.ceil(MUSICIAN[id].base * COST_GROWTH ** level(s, id));
  const boost = (lv) => 2 ** MILESTONES.filter((m) => lv >= m).length;
  const perBeat = (s, id) => { const lv = level(s, id); return MUSICIAN[id].beat * lv * boost(lv); };
  const bandPerBeat = (s) => MUSICIANS.reduce((sum, m) => sum + perBeat(s, m.id), 0);
  const perSecond = (s) => (bandPerBeat(s) * s.bpm) / 60;
  const nextMilestone = (lv) => MILESTONES.find((m) => m > lv) || null;
  // What a hit pays before the streak multiplier.
  const tapValue = (s, perfect) => (CLICK_BASE + CLICK_SHARE * bandPerBeat(s)) * (perfect ? PERFECT_MULT : 1);
  function multiplier(streak, free) {
    let m = 1;
    for (const [n, k] of COMBO) if (streak >= n) { m = k; break; }
    return free ? Math.min(m, FREE.cap) : m;
  }
  // The streak that gives the next multiplier, or null at the top.
  function nextTier(streak, free) {
    const now = multiplier(streak, free);
    const up = COMBO.slice().reverse().find(([n, k]) => n > streak && k > now && (!free || k <= FREE.cap));
    return up ? up[0] : null;
  }
  function earn(s, x) { s.coins += x; s.total += x; }

  // A musician shows up in the shop once the one before is hired or you are halfway to its price.
  function revealed(s, id) {
    const i = MUSICIANS.findIndex((m) => m.id === id);
    if (i <= 0) return i === 0;
    return level(s, id) > 0 || level(s, MUSICIANS[i - 1].id) > 0 || s.total >= MUSICIANS[i].base / 2;
  }
  function buy(s, id) {
    if (!MUSICIAN[id] || !revealed(s, id)) return false;
    const c = cost(s, id);
    if (s.coins < c) return false;
    s.coins -= c;
    s.levels[id] = level(s, id) + 1;
    return true;
  }

  const RUSH_LEVELS = (BPM.max - BPM.min) / BPM.step;
  const maxBpm = (s) => Math.min(BPM.max, BPM.min + BPM.step * s.rush);
  const rushCost = (s) => (s.rush >= RUSH_LEVELS ? Infinity : Math.ceil(RUSH.base * RUSH.growth ** s.rush));
  const rushRevealed = (s) => s.rush > 0 || s.total >= RUSH.base / 2;
  function buyRush(s) {
    const c = rushCost(s);
    if (!rushRevealed(s) || s.coins < c) return false;
    s.coins -= c;
    s.rush += 1;
    return true;
  }
  // Sets the tempo (clamped to the ceiling, rounded to a step). `from`: the first time that is still free to
  // change — now plus the music already booked.
  function setTempo(s, bpm, from) {
    const b = Math.max(BPM.min, Math.min(maxBpm(s), Math.round(bpm / BPM.step) * BPM.step));
    if (b === s.bpm) return false;
    s.bpm = b;
    if (s.run) s.run.grid = retime(s.run.grid, b, from);
    return true;
  }

  // ───────────── Playing ─────────────
  // A miss or a beat let pass cuts the streak in half: one slip costs a tier, a run of them costs everything.
  // Each beat costs the streak at most once, so a tap that comes too late is not punished twice.
  function cut(s, beat) {
    if (beat <= s.run.failed) return false;
    s.run.failed = beat;
    s.streak = Math.floor(s.streak / 2);
    return true;
  }

  // Settles every beat whose window has closed by `time`: a beat that closed without a hit cuts the streak.
  // In free play only a pause longer than FREE.idle resets it. Returns how many beats were let pass.
  function close(s, time) {
    const r = s.run;
    if (s.free) {
      if (s.streak > 0 && time - r.lastTap > FREE.idle) { s.streak = 0; return 1; }
      return 0;
    }
    const upTo = Math.floor(beatAt(r.grid, time - JUDGE.hit));
    let passed = 0;
    if (upTo - r.closed > 64) { passed = upTo - r.closed; s.streak = 0; r.closed = upTo; return passed; }
    for (let b = r.closed + 1; b <= upTo; b++) {
      // Windows of neighbouring beats never overlap (even at the top tempo a beat is longer than two windows),
      // so a beat was hit exactly when it is the last hit beat.
      if (b !== r.hit && s.streak > 0 && cut(s, b)) passed++;
    }
    if (upTo > r.closed) r.closed = upTo;
    return passed;
  }

  // A tap at `time`. Returns { grade: perfect | good | miss | extra, beat, delta, coins, mult, streak }.
  // A miss (outside the window, or a second tap on a beat) pays nothing and cuts the streak; it never takes
  // coins. In free play a second tap on a beat is just ignored ('extra').
  function tap(s, time) {
    const r = s.run;
    close(s, time);
    s.stats.taps++;
    let beat, delta, grade;
    if (s.free) {
      beat = Math.round(beatAt(r.grid, time));
      delta = time - timeOf(r.grid, beat);
      if (beat <= r.hit) {
        r.lastTap = time;
        return { grade: 'extra', beat, delta, coins: 0, mult: multiplier(s.streak, true), streak: s.streak };
      }
      grade = 'good';
    } else {
      ({ beat, delta, grade } = judge(r.grid, time));
      if (grade === 'miss' || beat <= r.hit) {
        cut(s, beat);
        s.stats.misses++;
        r.lastTap = time;
        return { grade: 'miss', beat, delta, coins: 0, mult: multiplier(s.streak, false), streak: s.streak };
      }
    }
    r.hit = beat;
    r.lastTap = time;
    s.streak++;
    s.best = Math.max(s.best, s.streak);
    s.stats.hits++;
    if (grade === 'perfect') s.stats.perfect++;
    const mult = multiplier(s.streak, s.free);
    const coins = tapValue(s, grade === 'perfect') * mult;
    earn(s, coins);
    return { grade, beat, delta, coins, mult, streak: s.streak };
  }

  // Moves the session to `time`: the band is paid for every beat that sounded, and beats let pass cut the
  // streak. Returns { paid, beats, passed }.
  function advance(s, time) {
    const r = s.run;
    const out = { paid: 0, beats: 0, passed: close(s, time) };
    const now = Math.floor(beatAt(r.grid, time));
    if (now > r.paid) {
      out.beats = now - r.paid;
      out.paid = out.beats * bandPerBeat(s);
      earn(s, out.paid);
      s.stats.beats += out.beats;
      r.paid = now;
    }
    return out;
  }

  // The band plays while you are away, without the groove. Returns what it earned.
  function offline(s, seconds) {
    const sec = Math.max(0, Math.min(Number(seconds) || 0, OFFLINE_MAX));
    const got = perSecond(s) * sec;
    earn(s, got);
    return got;
  }

  // Calibration: the median of tap offsets (seconds, + means the taps come late), clamped to sane values.
  function calibrate(deltas) {
    const d = deltas.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!d.length) return 0;
    const mid = d.length >> 1;
    const m = d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2;
    return Math.round(Math.max(-0.25, Math.min(0.45, m)) * 1000) / 1000;
  }

  // ───────────── Saving ─────────────
  function serialize(s) {
    return {
      v: 1, coins: s.coins, total: s.total, levels: { ...s.levels }, rush: s.rush, bpm: s.bpm, free: s.free,
      best: s.best, stats: { ...s.stats },
    };
  }
  function migrate(raw) {
    const s = newState();
    if (!raw || typeof raw !== 'object') return s;
    const num = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d);
    s.coins = num(raw.coins, 0);
    s.total = Math.max(num(raw.total, 0), s.coins);
    for (const m of MUSICIANS) {
      const lv = raw.levels && raw.levels[m.id];
      if (Number.isInteger(lv) && lv > 0) s.levels[m.id] = lv;
    }
    s.rush = Number.isInteger(raw.rush) ? Math.max(0, Math.min(RUSH_LEVELS, raw.rush)) : 0;
    s.bpm = Math.max(BPM.min, Math.min(maxBpm(s), Math.round(num(raw.bpm, BPM.min) / BPM.step) * BPM.step));
    s.free = raw.free === true;
    s.best = Math.floor(num(raw.best, 0));
    if (raw.stats && typeof raw.stats === 'object') for (const k of Object.keys(s.stats)) s.stats[k] = num(raw.stats[k], 0);
    return s;
  }

  const api = {
    JUDGE, COMBO, PERFECT_MULT, CLICK_BASE, CLICK_SHARE, FREE, BPM, RUSH, RUSH_LEVELS, COST_GROWTH, MILESTONES,
    OFFLINE_MAX, MUSICIANS, MUSICIAN,
    newGrid, beatAt, timeOf, retime, judge, newState, start, level, cost, boost, perBeat, bandPerBeat, perSecond,
    nextMilestone, tapValue, multiplier, nextTier, revealed, buy, maxBpm, rushCost, rushRevealed, buyRush, setTempo,
    close, tap, advance, offline, calibrate, serialize, migrate,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BeatCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
