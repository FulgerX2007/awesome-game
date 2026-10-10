// Комета — world generation and physics. No DOM, so a bot can play it in Node.
// Coordinates: x in [0, WIDTH], y grows downward; the climb goes toward negative y.
(function (root) {
  'use strict';

  const WIDTH = 540;
  const ORBIT_SPEED = 215;  // units/s along the orbit
  const FLY_SPEED = 340;    // units/s after release
  const VOID_TIME = 3.2;    // s of free flight before the comet is lost

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const height = (y) => Math.max(0, -y) / 10;

  // Outer reach of a planet, including its asteroid belt.
  const extent = (p) => (p.belt ? p.belt.r + p.belt.size : p.cap);

  function makePlanet(w, y, first) {
    const R = w.rand;
    const h = height(y);
    const roll = R();
    let kind = 'plain';
    if (!first) {
      if (h > 400 && roll < Math.min(0.12, (h - 400) / 4000)) kind = 'hole';
      else if (h > 250 && roll < 0.12 + Math.min(0.18, (h - 250) / 2500)) kind = 'belt';
      else if (h > 120 && roll < 0.45) kind = 'moving';
    }
    const r = kind === 'hole' ? 16 + R() * 6 : 18 + R() * 24;
    const p = {
      id: w.nextId++, kind, r, x: 0, y, baseX: 0,
      cap: r + (kind === 'hole' ? 88 : 58 + R() * 10),
      amp: 0, freq: 0, phase: R() * Math.PI * 2,
      hue: Math.floor(R() * 360), bands: 2 + Math.floor(R() * 3), ringed: kind === 'plain' && R() < 0.25,
      belt: null,
    };
    if (kind === 'belt') {
      const n = 3 + Math.floor(R() * 3);
      p.belt = { r: p.cap + 20, size: 9 + R() * 4, n, angle: R() * 6, speed: (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.5 + Math.min(0.6, h / 4000)) };
    }
    const e = extent(p);
    if (kind === 'moving') {
      p.amp = Math.min(70 + R() * 70, WIDTH / 2 - e - 10);
      p.freq = 0.5 + R() * 0.6 + Math.min(0.6, h / 3000);
    }
    const lo = e + 10 + p.amp, hi = WIDTH - e - 10 - p.amp;
    p.baseX = first ? WIDTH / 2 : lo + R() * Math.max(0, hi - lo);
    p.x = p.baseX;
    return p;
  }

  function generate(w, untilY) {
    while (w.genY > untilY) {
      const prev = w.planets[w.planets.length - 1];
      const gapExtra = 40 + w.rand() * 110 + Math.min(80, height(w.genY) / 30);
      const probe = makePlanet(w, w.genY - 200, false);
      probe.y = prev.y - extent(prev) - extent(probe) - gapExtra;
      w.planets.push(probe);
      // Stars hang in the gap between the two planets.
      const n = 1 + Math.floor(w.rand() * 3);
      for (let i = 0; i < n; i++) {
        const sy = prev.y - extent(prev) - 20 - w.rand() * Math.max(10, gapExtra - 40);
        w.stars.push({ x: 40 + w.rand() * (WIDTH - 80), y: sy, got: false, spin: w.rand() * 6 });
      }
      w.genY = probe.y;
    }
    // Forget what fell far behind.
    const floor = w.camTop + 2000;
    w.planets = w.planets.filter((p) => p.y < floor || p === w.player.planet);
    w.stars = w.stars.filter((s) => s.y < floor);
  }

  function createWorld(seed) {
    const w = {
      rand: rng(seed), nextId: 0, time: 0,
      planets: [], stars: [], genY: 0, camTop: -600,
      flareY: 420, maxY: 0, starsGot: 0, planetsVisited: 1,
      player: null, dead: null, events: [],
    };
    const home = makePlanet(w, 0, true);
    home.visited = true;
    w.planets.push(home);
    w.player = { x: 0, y: 0, vx: 0, vy: 0, state: 'orbit', planet: home, angle: Math.PI / 2, orbitR: home.r + 40, dir: 1, flyT: 0, lastPlanet: null };
    placeOnOrbit(w.player);
    generate(w, -1600);
    return w;
  }

  function placeOnOrbit(pl) {
    const p = pl.planet;
    pl.x = p.x + Math.cos(pl.angle) * pl.orbitR;
    pl.y = p.y + Math.sin(pl.angle) * pl.orbitR;
  }

  // Unit tangent of the current orbit (direction of travel).
  function tangent(pl) {
    return { x: -Math.sin(pl.angle) * pl.dir, y: Math.cos(pl.angle) * pl.dir };
  }

  function release(w) {
    const pl = w.player;
    if (pl.state !== 'orbit' || w.dead) return false;
    const t = tangent(pl);
    pl.vx = t.x * FLY_SPEED; pl.vy = t.y * FLY_SPEED;
    pl.state = 'fly'; pl.flyT = 0; pl.lastPlanet = pl.planet; pl.planet = null;
    w.events.push({ type: 'release' });
    return true;
  }

  function die(w, cause) {
    if (w.dead) return;
    w.dead = cause;
    w.events.push({ type: 'death', cause });
  }

  function step(w, dt) {
    if (w.dead) return;
    w.time += dt;
    const pl = w.player;

    for (const p of w.planets) {
      if (p.kind === 'moving') p.x = p.baseX + Math.sin(w.time * p.freq + p.phase) * p.amp;
      if (p.belt) p.belt.angle += p.belt.speed * dt;
    }

    if (pl.state === 'orbit') {
      const p = pl.planet;
      const speed = p.kind === 'hole' ? ORBIT_SPEED * 1.25 : ORBIT_SPEED;
      pl.angle += (speed / pl.orbitR) * pl.dir * dt;
      if (p.kind === 'hole') {
        pl.orbitR -= 11 * dt;
        if (pl.orbitR < p.r + 4) die(w, 'hole');
      }
      placeOnOrbit(pl);
    } else {
      pl.flyT += dt;
      pl.x += pl.vx * dt; pl.y += pl.vy * dt;
      for (const p of w.planets) {
        if (p === pl.lastPlanet && pl.flyT < 0.35) continue;
        const d = dist(pl.x, pl.y, p.x, p.y);
        if (d < p.cap) { capture(w, p, d); break; }
      }
      if (pl.state === 'fly') {
        if (pl.x < -30 || pl.x > WIDTH + 30 || pl.flyT > VOID_TIME) die(w, 'void');
      }
    }

    // Asteroid belts.
    for (const p of w.planets) {
      if (!p.belt) continue;
      for (let k = 0; k < p.belt.n; k++) {
        const a = p.belt.angle + (k / p.belt.n) * Math.PI * 2;
        if (dist(pl.x, pl.y, p.x + Math.cos(a) * p.belt.r, p.y + Math.sin(a) * p.belt.r) < p.belt.size + 5) die(w, 'asteroid');
      }
    }

    for (const s of w.stars) {
      if (!s.got && dist(pl.x, pl.y, s.x, s.y) < 20) {
        s.got = true; w.starsGot++;
        w.events.push({ type: 'star', x: s.x, y: s.y });
      }
    }

    w.maxY = Math.min(w.maxY, pl.y);
    // The flare rises faster with height and never lags too far behind.
    const h = height(w.maxY);
    w.flareY -= (16 + Math.min(52, h * 0.022)) * dt;
    w.flareY = Math.min(w.flareY, w.maxY + 560);
    if (pl.y > w.flareY) die(w, 'flare');

    w.camTop = Math.min(w.camTop, pl.y - 600);
    generate(w, w.camTop - 900);
  }

  function capture(w, p, d) {
    const pl = w.player;
    const rx = pl.x - p.x, ry = pl.y - p.y;
    pl.dir = rx * pl.vy - ry * pl.vx >= 0 ? 1 : -1;
    pl.angle = Math.atan2(ry, rx);
    pl.orbitR = Math.max(p.r + 14, Math.min(d, p.cap));
    pl.planet = p; pl.state = 'orbit'; pl.vx = pl.vy = 0;
    const fresh = !p.visited;
    if (fresh) { p.visited = true; w.planetsVisited++; }
    w.events.push({ type: 'capture', planet: p, fresh });
  }

  const score = (w) => Math.floor(height(w.maxY)) + w.starsGot * 10;

  const api = { WIDTH, ORBIT_SPEED, FLY_SPEED, rng, createWorld, step, release, tangent, height, score, extent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CometCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
