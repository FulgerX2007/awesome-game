'use strict';
// Bots for «Аншлаг»: they play the real rules (web/beat/core.js) with their own timing and buy greedily.
//   precise — taps every beat, off by about ±20 ms;
//   sloppy  — off by about ±60 ms, skips one beat in ten, shops every 5 seconds;
//   spam    — ten taps a second, blind to the beat;
//   free    — free play, about three taps a second;
//   idle    — never taps.
// simulate() returns the coins earned over time and when each musician was first hired.
const C = require('../../web/beat/core.js');

// mulberry32: a small seeded generator, so a run is the same every time.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
// A normal sample (Box–Muller).
const gauss = (rnd, sd) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()) * sd;

const PROFILES = {
  precise: { sd: 0.02, skip: 0, think: 1 },
  sloppy: { sd: 0.06, skip: 0.1, think: 5 },
  spam: { rate: 10, think: 2 },
  free: { rate: 3, think: 2, free: true },
  idle: { think: 2 },
};

// The option with the best payback (cost per extra coin a second), or null.
function bestBuy(s) {
  let best = null;
  for (const m of C.MUSICIANS) {
    if (!C.revealed(s, m.id)) continue;
    const before = C.perBeat(s, m.id);
    s.levels[m.id] = C.level(s, m.id) + 1;
    const gain = (C.perBeat(s, m.id) - before) * (s.bpm / 60) * 2; // ×2: hits pay a share of the band too
    s.levels[m.id] -= 1;
    if (!s.levels[m.id]) delete s.levels[m.id];
    const c = C.cost(s, m.id);
    if (gain > 0 && (!best || c / gain < best.ratio)) best = { kind: 'musician', id: m.id, cost: c, ratio: c / gain };
  }
  if (C.rushRevealed(s) && C.rushCost(s) < Infinity) {
    const gain = Math.max(1, C.perSecond(s) * 2) * (C.BPM.step / s.bpm);
    const c = C.rushCost(s);
    if (!best || c / gain < best.ratio) best = { kind: 'rush', cost: c, ratio: c / gain };
  }
  return best;
}

function shop(s, time) {
  for (let n = 0; n < 200; n++) {
    const b = bestBuy(s);
    if (!b || s.coins < b.cost) return;
    if (b.kind === 'rush') { C.buyRush(s); C.setTempo(s, C.maxBpm(s), time); } else C.buy(s, b.id);
  }
}

function simulate(kind, { minutes = 30, seed = 1, dt = 0.01 } = {}) {
  const p = PROFILES[kind];
  const rnd = rng(seed);
  const s = C.newState();
  s.free = !!p.free;
  C.start(s, 0.5);
  const firstHire = {};
  const samples = [];
  let nextThink = p.think;
  let nextSample = 60;
  // The next tap: on-beat bots aim at the next beat, rate bots tap at random intervals.
  let beat = 0;
  const nextBeatTap = () => {
    for (;;) {
      const b = beat++;
      if (p.skip && rnd() < p.skip) continue;
      return C.timeOf(s.run.grid, b) + gauss(rnd, p.sd);
    }
  };
  let tapAt = p.sd != null ? nextBeatTap() : p.rate ? 0.5 + rnd() / p.rate : Infinity;
  const end = minutes * 60;
  for (let time = 0; time < end; time += dt) {
    while (tapAt <= time) {
      C.advance(s, tapAt);
      C.tap(s, tapAt);
      if (p.sd != null) {
        // after a tempo change the beat numbers stay, only their times move
        tapAt = nextBeatTap();
        while (tapAt <= time - 1) tapAt = nextBeatTap();
      } else tapAt += (0.5 + rnd()) / p.rate;
    }
    C.advance(s, time);
    if (time >= nextThink) {
      shop(s, time + 0.2);
      for (const m of C.MUSICIANS) if (C.level(s, m.id) > 0 && firstHire[m.id] == null) firstHire[m.id] = time;
      nextThink += p.think;
    }
    if (time >= nextSample) { samples.push({ min: Math.round(time / 60), total: s.total, bpm: s.bpm }); nextSample += 60; }
  }
  return { state: s, firstHire, samples, total: s.total, best: s.best, bpm: s.bpm, stats: s.stats };
}

module.exports = { simulate, PROFILES, rng, gauss, bestBuy };

if (require.main === module) {
  const minutes = Number(process.argv[2]) || 30;
  for (const kind of Object.keys(PROFILES)) {
    const r = simulate(kind, { minutes });
    const hires = Object.entries(r.firstHire).map(([id, t]) => `${id} ${(t / 60).toFixed(1)}м`).join(', ');
    const at = (m) => (r.samples.find((x) => x.min === m) || {}).total || 0;
    console.log(`${kind.padEnd(8)} total ${r.total.toExponential(2)}  10м ${at(10).toExponential(2)}  20м ${at(20).toExponential(2)}  bpm ${r.bpm}  best ${r.best}  hits ${r.stats.hits} perfect ${r.stats.perfect} miss ${r.stats.misses}`);
    console.log(`         ${hires}  levels ${JSON.stringify(r.state.levels)} rush ${r.state.rush}`);
  }
}
