// Числовой забег — pure client helpers (no DOM): the pseudo-3D projection of the track, its inverse for the
// pointer, the soldier layouts of the crowd and the enemy army, number and gate labels, and the battle timeline.
// Works in the browser (window.RushView) and in Node (module.exports) so it can be tested.
// Units: x is the track coordinate (the track is x ∈ [-1, 1], HALF_M metres each side), z and heights are metres,
// screen points are CSS px of the canvas. The camera looks down the track from CAM_BACK metres behind the crowd.
(function (root) {
  'use strict';

  const CAM_BACK = 6;      // metres between the camera and the crowd
  const HORIZON = 0.3;     // horizon line, share of the canvas height
  const GROUND = 0.8;      // where the ground under the crowd is drawn, share of the height
  const HALF_M = 4;        // half the track width in metres
  const NEAR = 0.6;        // nearer than this (metres from the camera) is not drawn
  const FAR = 160;         // farther than this is not drawn
  const MAX_SOLDIERS = 150; // figures drawn at most; above that the bubble's number tells the rest
  const DEPTH_SQUASH = 0.6; // the crowd's disc is flattened along the track so it reads as a blob running ahead
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // A clean viewport { w, h } in CSS px; junk gives a 360×640 phone.
  function viewport(vp) {
    const v = vp || {};
    return { w: isNum(v.w) && v.w > 0 ? v.w : 360, h: isNum(v.h) && v.h > 0 ? v.h : 640 };
  }

  // Half the track width in px at the crowd's depth: wide on a phone, capped on a landscape screen.
  const trackHalf = (vp) => Math.min(0.44 * vp.w, 0.36 * vp.h);
  // px per metre at 1 m from the camera.
  const focal = (vp) => (trackHalf(vp) * CAM_BACK) / HALF_M;
  const horizonY = (vp) => vp.h * HORIZON;
  const groundY = (vp) => vp.h * GROUND;

  // Screen point of the track point (x, z), h metres above the ground, seen from a camera at camZ.
  // Returns { sx, sy, scale (px per metre there), d (metres from the camera) }, or null when it is too near.
  // y follows 1/d, so the ground recedes to the horizon; near things are larger and lower.
  function project(x, z, camZ, vp, h) {
    const v = viewport(vp);
    const d = z - camZ;
    if (!(d >= NEAR - 1e-9)) return null;
    const scale = focal(v) / d;
    const hy = horizonY(v);
    return {
      sx: v.w / 2 + x * HALF_M * scale,
      sy: hy + ((groundY(v) - hy) * CAM_BACK) / d - (h || 0) * scale,
      scale,
      d,
    };
  }

  // The ground point { x, z } under a screen point, or null above the horizon (or nearer than NEAR).
  // Without sy it answers for the crowd's depth: that is how a pointer's X becomes a steering target.
  function unproject(sx, sy, camZ, vp) {
    const v = viewport(vp);
    const hy = horizonY(v);
    const y = isNum(sy) ? sy : groundY(v);
    if (!(y > hy)) return null;
    const d = ((groundY(v) - hy) * CAM_BACK) / (y - hy);
    if (d < NEAR - 1e-9) return null;
    return { x: ((sx - v.w / 2) * d) / (HALF_M * focal(v)), z: camZ + d };
  }

  // Positions of the drawn soldiers of a crowd of `count` with radius r (track units): a sunflower spiral that fills
  // the disc evenly, densest in the middle. [{ dx, dy }] in track units, |(dx, dy)| ≤ r; dy runs along the track
  // (the client turns it into metres with HALF_M·DEPTH_SQUASH). At most `max` (MAX_SOLDIERS) figures.
  function crowdLayout(count, r, max) {
    const cap = Number.isInteger(max) && max >= 0 ? max : MAX_SOLDIERS;
    const n = Math.min(cap, Math.max(0, Math.floor(isNum(count) ? count : 0)));
    const rad = isNum(r) && r > 0 ? r : 0;
    const out = [];
    for (let i = 0; i < n; i++) {
      const rho = n === 1 ? 0 : rad * Math.sqrt((i + 0.5) / n);
      const a = i * GOLDEN;
      out.push({ dx: rho * Math.cos(a), dy: rho * Math.sin(a) });
    }
    return out;
  }

  // The enemy army as a block of ranks facing the crowd: [{ dx (track units), dz (metres back from the front) }].
  function armyLayout(count, max) {
    const cap = Number.isInteger(max) && max >= 0 ? max : MAX_SOLDIERS;
    const n = Math.min(cap, Math.max(0, Math.floor(isNum(count) ? count : 0)));
    const cols = Math.max(1, Math.min(15, Math.ceil(Math.sqrt(n * 2.5))));
    const out = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols); // the last rank may be short: it stays centred
      const col = i % cols;
      const span = cols === 1 ? 0 : (1.7 * (inRow - 1)) / (cols - 1);
      out.push({ dx: inRow === 1 ? 0 : -span / 2 + (span * col) / (inRow - 1), dz: row * 0.9 });
    }
    return out;
  }

  // Numbers as the bubbles show them: 1234, 12.3K, 123K, 1.2M.
  function fmt(n) {
    const v = isNum(n) ? Math.max(0, Math.round(n)) : 0;
    if (v < 10000) return String(v);
    if (v < 100000) return `${Math.floor(v / 100) / 10}K`;
    if (v < 1e6) return `${Math.floor(v / 1000)}K`;
    return `${Math.floor(v / 1e5) / 10}M`;
  }

  // Weapon level with one decimal and no trailing zero: 1, 1.4, 3.2.
  const fmtPower = (p) => String(Math.round((isNum(p) ? p : 0) * 10) / 10);

  // A gate's big label: +10, −5, ×2, ÷3, +1 (the weapon gate).
  function opLabel(g) {
    if (!g) return '';
    switch (g.op) {
      case 'add': return `+${g.n}`;
      case 'sub': return `−${g.n}`;
      case 'mul': return `×${g.n}`;
      case 'div': return `÷${g.n}`;
      case 'pow': return '+1';
      default: return '';
    }
  }
  // Green or red: an op that never weakens the crowd is good.
  const goodOp = (g) => !!g && (g.op === 'add' || g.op === 'mul' || g.op === 'pow');

  // ── Battle timeline ──
  // The result comes from core's finishBattle; the client only plays it out: the crowd charges, both sides melt
  // down to what core says is left, then (on a boss level, if the army fell) the crowd walks up to the boss and
  // the boss's HP melts. Durations in seconds.
  const BATTLE = { charge: 0.6, army: 1.6, walk: 0.5, boss: 1.3, tail: 0.7 };

  // run: the settled run (finishBattle done); start: { count, power } at the finish line.
  function battlePlan(run, start) {
    const res = run.result;
    const L = run.level;
    const power = start.power;
    const pe = L.enemy.power;
    const S = start.count * power;
    const Se = L.enemy.count * pe;
    const armyBeaten = S > Se + 1e-9;
    const hasBoss = !!L.boss && armyBeaten;
    const plan = {
      ours0: start.count,
      enemy0: L.enemy.count,
      boss0: L.boss ? L.boss.hp : 0,
      oursMid: armyBeaten ? Math.max(res.won ? res.survivors : 0, Math.ceil((S - Se) / power - 1e-9)) : 0,
      enemyEnd: armyBeaten ? 0 : Math.ceil((Se - S) / pe - 1e-9),
      oursEnd: res.won ? res.survivors : 0,
      bossEnd: L.boss ? (res.won ? 0 : hasBoss ? Math.max(1, Math.ceil(L.boss.hp - (S - Se) - 1e-9)) : L.boss.hp) : 0,
      hasBoss,
      won: res.won,
      t: { ...BATTLE },
    };
    if (!armyBeaten) plan.oursEnd = 0;
    plan.total = BATTLE.charge + BATTLE.army + (hasBoss ? BATTLE.walk + BATTLE.boss : 0) + BATTLE.tail;
    return plan;
  }

  const ease = (k) => 1 - (1 - k) * (1 - k);
  const lerpInt = (a, b, k) => Math.round(a + (b - a) * ease(clamp(k, 0, 1)));

  // What the battle shows at time t: { phase: charge|army|walk|boss|done, k (0..1 in the phase), ours, enemy, boss }.
  function battleAt(plan, t) {
    const T = plan.t;
    let rest = Math.max(0, isNum(t) ? t : 0);
    const out = (phase, k, ours, enemy, boss) => ({ phase, k: clamp(k, 0, 1), ours, enemy, boss });
    if (rest < T.charge) return out('charge', rest / T.charge, plan.ours0, plan.enemy0, plan.boss0);
    rest -= T.charge;
    if (rest < T.army) {
      const k = rest / T.army;
      return out('army', k, lerpInt(plan.ours0, plan.oursMid, k), lerpInt(plan.enemy0, plan.enemyEnd, k), plan.boss0);
    }
    rest -= T.army;
    if (plan.hasBoss) {
      if (rest < T.walk) return out('walk', rest / T.walk, plan.oursMid, plan.enemyEnd, plan.boss0);
      rest -= T.walk;
      if (rest < T.boss) {
        const k = rest / T.boss;
        return out('boss', k, lerpInt(plan.oursMid, plan.oursEnd, k), plan.enemyEnd, lerpInt(plan.boss0, plan.bossEnd, k));
      }
      rest -= T.boss;
    }
    return out('done', rest / T.tail, plan.oursEnd, plan.enemyEnd, plan.bossEnd);
  }

  const api = {
    CAM_BACK, HORIZON, GROUND, HALF_M, NEAR, FAR, MAX_SOLDIERS, DEPTH_SQUASH, BATTLE,
    clamp, viewport, trackHalf, focal, horizonY, groundY, project, unproject, crowdLayout, armyLayout,
    fmt, fmtPower, opLabel, goodOp, battlePlan, battleAt,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RushView = api;
})(typeof window !== 'undefined' ? window : globalThis);
