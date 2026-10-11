// Глубина — eat-and-grow ocean simulation. No DOM, so a bot can play it in Node.
// Everything is in world units; the camera zooms out as the player grows.
(function (root) {
  'use strict';

  // Creature kinds by absolute radius. speed is relative to the player's speed at the same size.
  const KINDS = [
    { id: 'plankton', max: 2.5, speed: 0.15 },
    { id: 'cell', max: 6, speed: 0.45 },
    { id: 'krill', max: 14, speed: 0.6, flee: true },
    { id: 'minnow', max: 30, speed: 0.75, flee: true, school: true },
    { id: 'fish', max: 70, speed: 0.78, flee: true, hunter: true },
    { id: 'squid', max: 150, speed: 0.8, flee: true, hunter: true },
    { id: 'shark', max: 330, speed: 0.82, hunter: true },
    { id: 'whale', max: Infinity, speed: 0.4 },
  ];
  const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));
  const STAGES = [
    { kind: 'cell', name: 'Клетка', from: 0 },
    { kind: 'krill', name: 'Рачок', from: 6 },
    { kind: 'minnow', name: 'Малёк', from: 14 },
    { kind: 'fish', name: 'Рыба', from: 30 },
    { kind: 'squid', name: 'Кальмар', from: 70 },
    { kind: 'shark', name: 'Акула', from: 150 },
    { kind: 'whale', name: 'Кит', from: 330 },
  ];
  const START_R = 3;
  const EAT_RATIO = 1.12;   // must be this much bigger to swallow
  const GAIN = 0.5;         // share of prey mass you keep
  const DASH_TIME = 0.6, DASH_COOLDOWN = 3, DASH_MULT = 2.3;
  const CHASE_LIMIT = 4.5, REST_TIME = 3;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const kindFor = (r, R) => {
    const k = KINDS.find((x) => r < x.max).id;
    // Mid-size creatures are sometimes drifting jellyfish instead of fish.
    return k === 'fish' && R() < 0.35 ? 'jelly' : k;
  };
  const traits = (e) => (e.kind === 'jelly' ? { speed: 0.3 } : KIND[e.kind]);
  const stageOf = (r) => { let s = 0; STAGES.forEach((st, i) => { if (r >= st.from) s = i; }); return s; };
  const baseSpeed = (r) => 90 * (r / 4) ** 0.7;
  // World height that fits on screen for a player of radius r.
  const viewSize = (r) => 170 * (Math.max(r, START_R) / 4) ** 0.85;

  // Real-world length for the HUD: 10 µm cell up to a ~30 m whale.
  function lengthMeters(r) { return 1e-5 * (r / 3) ** 3.2; }
  function lengthText(r) {
    const m = lengthMeters(r);
    const f = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)).toString().replace('.', ',');
    if (m < 1e-3) return `${f(m * 1e6)} мкм`;
    if (m < 1e-2) return `${f(m * 1e3)} мм`;
    if (m < 1) return `${f(m * 1e2)} см`;
    return `${f(m)} м`;
  }

  function createWorld(seed, r0 = START_R) {
    const w = {
      R: rng(seed), time: 0, nextId: 1, ents: [], events: [], deaths: 0,
      player: { x: 0, y: 0, vx: 0, vy: 0, r: r0, peak: r0, angle: 0, dashT: 0, dashCD: 0, invuln: 2, stage: stageOf(r0) },
    };
    populate(w, true);
    return w;
  }

  function spawn(w, r, near) {
    const p = w.player, V = viewSize(p.r);
    const a = w.R() * Math.PI * 2;
    const d = near ? V * (0.35 + w.R() * 1.5) : V * (1.15 + w.R() * 0.75);
    const kind = kindFor(r, w.R);
    const e = {
      id: w.nextId++, kind, r, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d,
      vx: 0, vy: 0, angle: w.R() * Math.PI * 2, heading: w.R() * Math.PI * 2,
      mode: 'wander', target: null, think: w.R() * 0.3, chase: 0, rest: 0, hue: w.R(), phase: w.R() * 6,
    };
    // Don't drop a hungry hunter right on top of the player.
    if (KIND[kind]?.hunter && r > p.r && Math.hypot(e.x - p.x, e.y - p.y) < V * 0.9) return null;
    w.ents.push(e);
    return e;
  }

  // Keep a steady population around the player, sized relative to the player.
  function populate(w, initial) {
    const p = w.player, V = viewSize(p.r);
    w.ents = w.ents.filter((e) => Math.hypot(e.x - p.x, e.y - p.y) < V * 2.3);
    let food = 0, others = 0, bigHunters = 0;
    for (const e of w.ents) {
      if (e.r < p.r * 0.45) food++; else others++;
      if (KIND[e.kind]?.hunter && e.r > p.r * EAT_RATIO) bigHunters++;
    }
    for (let guard = 0; food < 32 && guard < 200; guard++) if (spawn(w, p.r * (0.25 + w.R() * 0.3), initial)) food++;
    for (let guard = 0; others < 34 && guard < 200; guard++) {
      const roll = w.R();
      let r;
      if (roll < 0.5) r = p.r * (0.45 + w.R() * 0.4);
      else if (roll < 0.7) r = p.r * (0.85 + w.R() * 0.4);
      else r = p.r * (1.3 + w.R() * 2.4);
      const e = spawn(w, r, initial);
      if (!e) continue;
      if (KIND[e.kind]?.hunter && r > p.r * EAT_RATIO) {
        if (bigHunters >= 3) { w.ents.pop(); continue; }
        bigHunters++;
      }
      others++;
    }
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function think(w, e) {
    const p = w.player, t = traits(e);
    const sense = e.r * 7 + 80;
    e.mode = 'wander'; e.target = null;
    if (t.flee) {
      let threat = null, td = Infinity;
      const check = (o) => {
        if (o === e || o.r <= e.r * EAT_RATIO) return;
        if (o !== p && !KIND[o.kind]?.hunter) return;
        const d = dist(o, e);
        if (d < sense && d < td) { threat = o; td = d; }
      };
      check(p);
      for (const o of w.ents) check(o);
      if (threat) { e.mode = 'flee'; e.target = threat; return; }
    }
    if (t.hunter && e.rest <= 0) {
      let prey = null, pd = Infinity;
      const check = (o) => {
        if (o === e || e.r <= o.r * EAT_RATIO) return;
        const d = dist(o, e);
        if (d < sense && d < pd) { prey = o; pd = d; }
      };
      if (p.invuln <= 0) check(p);
      for (const o of w.ents) check(o);
      if (prey) { e.mode = 'hunt'; e.target = prey; }
    }
  }

  function moveEntity(w, e, dt) {
    const t = traits(e);
    e.think -= dt;
    if (e.think <= 0) { e.think = 0.25 + w.R() * 0.15; think(w, e); }
    if (e.target && e.target !== w.player && !w.ents.includes(e.target)) { e.target = null; e.mode = 'wander'; }
    let speed = baseSpeed(e.r) * t.speed;
    let dirX, dirY;
    if (e.mode === 'flee' && e.target) {
      dirX = e.x - e.target.x; dirY = e.y - e.target.y;
    } else if (e.mode === 'hunt' && e.target) {
      e.chase += dt;
      if (e.chase > CHASE_LIMIT) { e.rest = REST_TIME; e.chase = 0; e.mode = 'wander'; e.target = null; }
      dirX = (e.target?.x ?? e.x) - e.x; dirY = (e.target?.y ?? e.y) - e.y;
      speed *= 0.95;
    } else {
      e.heading += (w.R() - 0.5) * dt * 2;
      dirX = Math.cos(e.heading); dirY = Math.sin(e.heading);
      speed *= e.kind === 'plankton' || e.kind === 'jelly' || e.kind === 'whale' ? 0.6 : 0.35;
    }
    if (e.rest > 0) { e.rest -= dt; speed *= 0.5; }
    const len = Math.hypot(dirX, dirY) || 1;
    const k = 1 - Math.exp(-dt * 3);
    e.vx += ((dirX / len) * speed - e.vx) * k;
    e.vy += ((dirY / len) * speed - e.vy) * k;
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (Math.hypot(e.vx, e.vy) > 1) e.angle = Math.atan2(e.vy, e.vx);
    e.phase += dt * (2 + Math.hypot(e.vx, e.vy) / (e.r + 4));
  }

  function grow(p, prey) {
    p.r = Math.sqrt(p.r * p.r + prey.r * prey.r * GAIN);
    p.peak = Math.max(p.peak, p.r);
  }

  // input: { tx, ty } point to swim toward (world), or null to drift; dash: boolean.
  function step(w, dt, input) {
    const p = w.player;
    w.time += dt;
    p.invuln = Math.max(0, p.invuln - dt);
    p.dashCD = Math.max(0, p.dashCD - dt);
    p.dashT = Math.max(0, p.dashT - dt);
    if (input?.dash && p.dashCD <= 0) { p.dashT = DASH_TIME; p.dashCD = DASH_COOLDOWN; w.events.push({ type: 'dash' }); }

    let ax = 0, ay = 0;
    if (input && input.tx !== undefined) {
      const dx = input.tx - p.x, dy = input.ty - p.y, d = Math.hypot(dx, dy);
      if (d > 0.5) { const f = Math.min(1, d / (p.r * 2.5)); ax = (dx / d) * f; ay = (dy / d) * f; }
    }
    const max = baseSpeed(p.r) * (p.dashT > 0 ? DASH_MULT : 1);
    const k = 1 - Math.exp(-dt * 4);
    p.vx += (ax * max - p.vx) * k; p.vy += (ay * max - p.vy) * k;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (Math.hypot(p.vx, p.vy) > 2) p.angle = Math.atan2(p.vy, p.vx);

    for (const e of w.ents) moveEntity(w, e, dt);

    // Who eats whom.
    const eaten = new Set();
    for (const e of w.ents) {
      const d = dist(p, e);
      if (p.r > e.r * EAT_RATIO && d < p.r) {
        eaten.add(e); grow(p, e);
        w.events.push({ type: 'eat', r: e.r, kind: e.kind, x: e.x, y: e.y });
      } else if (KIND[e.kind]?.hunter && e.r > p.r * EAT_RATIO && d < e.r && p.invuln <= 0) {
        die(w, e);
        break;
      }
    }
    for (const h of w.ents) {
      if (!KIND[h.kind]?.hunter || eaten.has(h) || h.mode !== 'hunt') continue;
      for (const o of w.ents) {
        if (o === h || eaten.has(o) || h.r <= o.r * EAT_RATIO) continue;
        if (dist(h, o) < h.r) { eaten.add(o); h.mode = 'wander'; h.target = null; break; }
      }
    }
    if (eaten.size) w.ents = w.ents.filter((e) => !eaten.has(e));

    const st = stageOf(p.r);
    if (st > p.stage) { p.stage = st; w.events.push({ type: 'stage', stage: st }); }
    if (st < p.stage) p.stage = st;
    populate(w, false);
  }

  // Being eaten costs half your mass, never the run.
  function die(w, killer) {
    const p = w.player;
    w.deaths++;
    w.events.push({ type: 'death', x: p.x, y: p.y, by: killer.kind });
    p.r = Math.max(START_R, p.r / Math.SQRT2);
    p.invuln = 3; p.vx = p.vy = 0;
    p.stage = stageOf(p.r);
    const V = viewSize(p.r);
    w.ents = w.ents.filter((e) => !(KIND[e.kind]?.hunter && e.r > p.r && dist(e, p) < V * 1.5));
  }

  const api = {
    KINDS, STAGES, START_R, EAT_RATIO, DASH_COOLDOWN, rng, createWorld, step, stageOf, viewSize, baseSpeed,
    lengthMeters, lengthText, traits, isHunter: (e) => !!KIND[e.kind]?.hunter,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DeepCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
