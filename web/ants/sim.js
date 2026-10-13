'use strict';
// Муравейник — the ant world: agents, two pheromone fields, food piles. No DOM, so Node can run it headless.
// Ants search for food following the "food" scent and lay "home" scent; carrying food they follow "home" and lay "food".
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AntSim = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  const CS = 4;            // pheromone cell size in world units
  const SENSE = 9;         // how far ahead an ant smells
  const SENSE_ANGLE = 0.6;
  const NEST_R = 12;
  const MAX_AGENTS = 360;  // above this, each visible ant stands for several
  const TURN = 3.2;        // fastest turn toward a scent, rad/s
  const SPIN_LIMIT = Math.PI * 2; // a full circle in a few seconds means the ant is going round

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // w, h: world size in units (the UI picks them from the screen's aspect ratio).
  function create(w, h, seed = 1) {
    const gw = Math.ceil(w / CS), gh = Math.ceil(h / CS);
    return {
      w, h, gw, gh, R: mulberry32(seed),
      nest: { x: w / 2, y: h / 2 },
      home: new Float32Array(gw * gh),
      food: new Float32Array(gw * gh),
      ants: [], piles: [], respawn: [],
      bigs: [], arrived: [], // big finds being dragged home, and kinds that reached the nest
      delivered: 0,       // food units brought home since the last take()
      t: 0,
    };
  }
  const cell = (s, x, y) => {
    const gx = Math.floor(x / CS), gy = Math.floor(y / CS);
    if (gx < 0 || gy < 0 || gx >= s.gw || gy >= s.gh) return -1;
    return gy * s.gw + gx;
  };
  function smell(s, field, x, y) {
    const i = cell(s, x, y);
    return i < 0 ? -1 : field[i];
  }
  // A sensor reads two points along its ray, so a single strong cell beside the ant cannot capture it.
  function sense(s, field, a, off) {
    const dx = Math.cos(a.a + off), dy = Math.sin(a.a + off);
    const far = smell(s, field, a.x + dx * SENSE, a.y + dy * SENSE);
    const near = smell(s, field, a.x + dx * SENSE * 0.55, a.y + dy * SENSE * 0.55);
    return far < 0 || near < 0 ? -1 : (far + near) * 0.5;
  }
  function addAnt(s) {
    const a = s.R() * Math.PI * 2;
    s.ants.push({ x: s.nest.x + Math.cos(a) * 4, y: s.nest.y + Math.sin(a) * 4, a, carry: 0, since: 0, legs: s.R() * 10, spin: 0, lost: 0 });
  }
  // Keeps the number of agents in step with the colony (capped for speed).
  function syncAnts(s, n) {
    const want = Math.min(MAX_AGENTS, Math.floor(n));
    while (s.ants.length < want) addAnt(s);
    if (s.ants.length > want) s.ants.length = want;
    if (!s.ants.length) s.bigs.length = 0;
  }
  // Places a food pile at distance d from the nest (or at x, y when given).
  function spot(s, d) {
    let x = s.nest.x, y = s.nest.y;
    for (let tries = 0; tries < 30; tries++) {
      const a = s.R() * Math.PI * 2;
      x = s.nest.x + Math.cos(a) * d; y = s.nest.y + Math.sin(a) * d;
      if (x > 14 && y > 14 && x < s.w - 14 && y < s.h - 14) break;
    }
    return { x: Math.max(14, Math.min(s.w - 14, x)), y: Math.max(14, Math.min(s.h - 14, y)) };
  }
  function addPile(s, amount, d, x, y, crumb = false, kind = null) {
    if (x == null) ({ x, y } = spot(s, d));
    kind = kind || (crumb ? 'crumb' : ['berry', 'seed', 'sugar', 'apple'][Math.floor(s.R() * 4)]);
    amount = Math.max(1, Math.round(amount));
    s.piles.push({ x, y, amount, max: amount, kind, crumb, rot: s.R() * 6.28 });
  }
  const pileR = (p) => 3 + Math.min(9, Math.sqrt(p.amount) * 0.6);
  // A big find that needs `need` ants holding it before it starts to move.
  function addBig(s, kind, need, d) {
    const p = spot(s, d);
    s.bigs.push({ x: p.x, y: p.y, kind, need, carriers: 0, rot: s.R() * 6.28, moving: false });
  }
  const bigR = (b) => 5 + Math.min(6, b.need * 0.35);

  // Pushes scent into the field around (x, y).
  function lay(s, field, x, y, v) {
    const i = cell(s, x, y);
    if (i >= 0 && field[i] < 60) field[i] += v;
  }
  // Drag trail from the player: a strong "food" scent line.
  function paint(s, x1, y1, x2, y2, v = 6) {
    const d = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(d / (CS * 0.7)));
    for (let k = 0; k <= n; k++) {
      const x = x1 + (x2 - x1) * k / n, y = y1 + (y2 - y1) * k / n;
      const i = cell(s, x, y);
      if (i >= 0) s.food[i] = Math.min(60, s.food[i] + v);
    }
  }

  // p: { speed, carry, evaporation, territory, pileCount, pileAmount }
  function step(s, dt, p) {
    s.t += dt;
    const evap = Math.exp(-p.evaporation * dt);
    for (let i = 0; i < s.home.length; i++) { s.home[i] *= evap; s.food[i] *= evap; }
    // Food comes back over time, farther out as the territory grows.
    s.respawn = s.respawn.filter((r) => {
      r.t -= dt;
      if (r.t > 0) return true;
      addPile(s, p.pileAmount * (0.6 + s.R() * 0.8), p.territory * (0.45 + s.R() * 0.55));
      return false;
    });
    const natural = s.piles.filter((q) => !q.crumb).length + s.respawn.length;
    for (let k = natural; k < p.pileCount; k++) s.respawn.push({ t: 1 + s.R() * 4 });

    const speed = p.speed * dt;
    for (const b of s.bigs) b.carriers = 0;
    for (const a of s.ants) if (a.big) a.big.carriers++;
    for (const a of s.ants) {
      if (a.big) continue;
      a.since += dt;
      a.legs += dt * p.speed * 0.6;
      const returning = a.carry > 0;
      const field = returning ? s.home : s.food;
      const before = a.a;
      const toNest = Math.atan2(s.nest.y - a.y, s.nest.x - a.x), nestD = Math.hypot(s.nest.x - a.x, s.nest.y - a.y);
      if (a.lost > 0) {
        // Breaking out of a loop: ignore scent for a moment and walk straight, outward or home.
        a.lost -= dt;
        a.a = turnTo(a.a, returning ? toNest : toNest + Math.PI, 0.8 * dt);
      } else if (!returning && nestD < NEST_R * 2.2) {
        // Every trail ends at the nest, so its scent is useless right there: just head out.
        a.a = turnTo(a.a, toNest + Math.PI, 2 * dt);
      } else {
        // Three sensors ahead. The turn grows with the difference between the sides, so ants
        // ease onto a trail instead of spinning around the strongest cell.
        const l = sense(s, field, a, -SENSE_ANGLE), c = sense(s, field, a, 0), r = sense(s, field, a, SENSE_ANGLE);
        const top = Math.max(l, c, r);
        if (top > 0.02) {
          const side = (r - l) / (top + 0.5);
          a.a += Math.max(-1, Math.min(1, side * (c >= top ? 0.4 : 1.6))) * TURN * dt;
        }
        a.a += (s.R() - 0.5) * 2.4 * dt * (c > 0.05 ? 0.5 : 1.6);
      }
      // Close to home or food, ants see it and head straight in.
      if (returning) {
        const d = nestD;
        // Ants remember roughly where home is: a carrier leans toward the nest, harder the longer it
        // walks, so a ring of home scent cannot hold it.
        a.a = turnTo(a.a, toNest, (d < NEST_R * 3.5 ? 4 : Math.min(2.5, 1.4 + a.since * 0.2)) * dt);
        if (d < NEST_R) {
          s.delivered += a.carry;
          a.carry = 0; a.since = 0; a.a += Math.PI;
        }
      } else {
        for (const b of s.bigs) {
          // A find that already has a full team does not draw more ants to circle around it.
          if (b.carriers >= b.need * 2) continue;
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), br = bigR(b);
          if (d < br + 24) a.a = turnTo(a.a, Math.atan2(dy, dx), 5 * dt);
          if (d < br + 1.5 && b.carriers < b.need * 2) {
            a.big = b; b.carriers++; a.slot = Math.atan2(a.y - b.y, a.x - b.x); a.since = 0;
            break;
          }
        }
        if (a.big) continue;
        for (const q of s.piles) {
          const dx = q.x - a.x, dy = q.y - a.y, d = Math.hypot(dx, dy), pr = pileR(q);
          if (d < pr + 14) a.a = turnTo(a.a, Math.atan2(dy, dx), 5 * dt);
          if (d < pr + 1.5) {
            const take = Math.min(p.carry, q.amount);
            q.amount -= take; a.carry = take; a.load = q.kind; a.since = 0; a.a += Math.PI;
            break;
          }
        }
      }
      // Walls: ants feel the edge ahead and turn back inside, so they never slide along it laying a
      // scent road that loops around the whole field.
      const m = 10;
      if (a.x < m || a.y < m || a.x > s.w - m || a.y > s.h - m) {
        const inward = Math.atan2(s.h / 2 - a.y, s.w / 2 - a.x);
        a.a = turnTo(a.a, inward, 3 * dt);
      }
      // Count how far the ant has turned lately; a full circle sends it off the scent for a while.
      let turn = a.a - before;
      if (turn > Math.PI) turn -= Math.PI * 2; else if (turn < -Math.PI) turn += Math.PI * 2;
      a.spin = (a.spin || 0) * Math.exp(-dt / 2.5) + turn;
      if (Math.abs(a.spin) > SPIN_LIMIT && !(a.lost > 0)) { a.lost = 1 + s.R() * 0.8; a.spin = 0; }
      a.x += Math.cos(a.a) * speed;
      a.y += Math.sin(a.a) * speed;
      if (a.x < 2 || a.x > s.w - 2) { a.a = Math.PI - a.a; a.x = Math.max(2, Math.min(s.w - 2, a.x)); }
      if (a.y < 2 || a.y > s.h - 2) { a.a = -a.a; a.y = Math.max(2, Math.min(s.h - 2, a.y)); }
      // The fresher the trip, the stronger the scent: short paths win.
      const v = Math.exp(-a.since / 25) * 6 * dt * 4;
      if (a.x > m && a.y > m && a.x < s.w - m && a.y < s.h - m) lay(s, returning ? s.food : s.home, a.x, a.y, v);
      // Lost ants give up after a long walk and wander home by memory.
      if (!returning && a.since > 60) { a.a = turnTo(a.a, Math.atan2(s.nest.y - a.y, s.nest.x - a.x), 1.5 * dt); }
    }
    // Big finds: with enough ants holding on they creep toward the nest, scenting the way.
    for (const b of s.bigs) {
      // A sweet smell spreads around a find, so ants notice it from afar.
      const gx = Math.floor(b.x / CS), gy = Math.floor(b.y / CS), R = 7;
      for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
        const d2 = ox * ox + oy * oy;
        if (d2 > R * R) continue;
        const cx = gx + ox, cy = gy + oy;
        if (cx < 0 || cy < 0 || cx >= s.gw || cy >= s.gh) continue;
        const i = cy * s.gw + cx;
        if (s.food[i] < 6) s.food[i] += 3 * dt * (1 - Math.sqrt(d2) / R);
      }
      b.moving = b.carriers >= b.need;
      if (b.moving) {
        const dx = s.nest.x - b.x, dy = s.nest.y - b.y, d = Math.hypot(dx, dy) || 1;
        const v = p.speed * 0.3 * Math.min(1.6, b.carriers / b.need) * dt;
        b.x += dx / d * v; b.y += dy / d * v;
        b.rot += Math.sin(s.t * 3) * 0.3 * dt;
        if (d < NEST_R + bigR(b) * 0.5) b.done = true;
      }
    }
    for (const a of s.ants) {
      if (!a.big) continue;
      const b = a.big, br = bigR(b);
      if (b.done) { a.big = null; a.since = 0; a.a = a.slot; continue; }
      a.x = b.x + Math.cos(a.slot) * (br + 1.6); a.y = b.y + Math.sin(a.slot) * (br + 1.6);
      a.a = a.slot + Math.PI;
      if (b.moving) { a.legs += dt * p.speed * 0.6; lay(s, s.food, a.x, a.y, 2 * dt * 4); }
    }
    for (const b of s.bigs) if (b.done) s.arrived.push(b.kind);
    s.bigs = s.bigs.filter((b) => !b.done);
    for (const q of s.piles) if (q.amount <= 0 && !q.crumb) s.respawn.push({ t: 1.5 + s.R() * 3 });
    s.piles = s.piles.filter((q) => q.amount > 0);
  }
  function turnTo(a, target, max) {
    let d = target - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + Math.max(-max, Math.min(max, d));
  }
  // Returns and resets the food brought home since the last call.
  function take(s) { const d = s.delivered; s.delivered = 0; return d; }

  // Kinds of big finds that reached the nest since the last call.
  function arrivals(s) { const a = s.arrived; s.arrived = []; return a; }

  return { CS, NEST_R, MAX_AGENTS, create, syncAnts, addPile, addBig, paint, step, take, arrivals, pileR, bigR, cell };
});
