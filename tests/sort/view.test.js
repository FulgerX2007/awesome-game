'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../web/sort/view.js');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} ≈ ${b}`);

const VIEWPORTS = [
  { w: 360, h: 520 },   // a phone held upright, minus header and controls
  { w: 768, h: 760 },
  { w: 1280, h: 640 },
];

test('the layout fits every tube count on every screen', () => {
  for (const vp of VIEWPORTS) {
    for (const n of [5, 9, 15]) {
      for (const cap of [4, 5]) {
        const L = V.layout(n, cap, vp);
        assert.equal(L.tubes.length, n);
        assert.ok(L.cssW <= vp.w && L.cssH <= vp.h, `${n} tubes × ${cap} in ${vp.w}×${vp.h}: ${L.cssW}×${L.cssH}`);
        for (const t of L.tubes) {
          assert.ok(t.x >= 0 && t.x + t.w <= L.cssW + 0.5, 'inside horizontally');
          assert.ok(t.y - V.LIFT * L.unit >= 0, 'room to lift');
          assert.ok(t.y + t.h <= L.cssH + 0.5, 'inside vertically');
        }
        // no overlaps
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          const a = L.tubes[i], b = L.tubes[j];
          const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          assert.ok(apart, `tubes ${i} and ${j} overlap`);
        }
      }
    }
  }
});

test('one row up to seven tubes, two rows above', () => {
  assert.equal(V.layout(7, 4, VIEWPORTS[0]).rows, 1);
  const two = V.layout(8, 4, VIEWPORTS[0]);
  assert.equal(two.rows, 2);
  assert.equal(new Set(two.tubes.map((t) => t.y)).size, 2);
  // second row is centred under the first
  const L = V.layout(9, 4, VIEWPORTS[1]);
  const row = (y) => L.tubes.filter((t) => t.y === y);
  const ys = [...new Set(L.tubes.map((t) => t.y))];
  const mid = (r) => (r[0].x + r[r.length - 1].x + r[0].w) / 2;
  assert.ok(Math.abs(mid(row(ys[0])) - mid(row(ys[1]))) < 1);
});

test('tubes on a phone stay big enough to tap', () => {
  const L = V.layout(15, 5, VIEWPORTS[0]);
  assert.ok(L.tubes[0].w >= 26, `tube width ${L.tubes[0].w}`);
});

test('big screens cap the tube size; dpr scales the canvas', () => {
  const L = V.layout(5, 4, { w: 3000, h: 3000, dpr: 2 });
  assert.equal(L.unit, V.MAX_UNIT);
  assert.equal(L.w, Math.round(L.cssW * 2));
  assert.equal(V.layout(5, 4, { w: 300, h: 300, dpr: 9 }).dpr, 3);
  assert.equal(V.layout(5, 4, {}).tubes.length, 5, 'a missing viewport falls back to defaults');
});

test('tubeAt hits tubes with a padded area and misses the gaps between rows', () => {
  const L = V.layout(9, 4, VIEWPORTS[1]);
  L.tubes.forEach((t, i) => {
    assert.equal(V.tubeAt(L, t.x + t.w / 2, t.y + t.h / 2), i, 'centre');
    assert.equal(V.tubeAt(L, t.x - 2, t.y + t.h / 2), i, 'just left of the glass');
    assert.equal(V.tubeAt(L, t.x + t.w / 2, t.y - V.LIFT * L.unit), i, 'where a lifted tube is');
  });
  assert.equal(V.tubeAt(L, 1, 1), -1, 'the corner');
  assert.equal(V.tubeAt(L, L.cssW / 2, L.cssH + 50), -1, 'below everything');
});

test('layer boxes stack from the bottom inside the tube', () => {
  const L = V.layout(5, 4, VIEWPORTS[1]);
  const t = L.tubes[0];
  const b0 = V.layerBox(L, t, 0), b3 = V.layerBox(L, t, 3);
  assert.ok(b0.y > b3.y);
  assert.ok(b0.y + b0.h <= t.y + t.h);
  assert.ok(b3.y >= t.y, 'a full tube stays under the rim');
  assert.ok(b0.x > t.x && b0.x + b0.w < t.x + t.w);
});

test('pour timeline: stages run in order and longer pours flow longer', () => {
  const one = V.pourTimeline(1), four = V.pourTimeline(4);
  assert.ok(four.flow > one.flow);
  assert.ok(four.total > one.total);
  const tl = one;
  let st = V.pourAt(tl, 0);
  assert.deepEqual([st.move, st.tilt, st.flow, st.back, st.done], [0, 0, 0, 0, false]);
  st = V.pourAt(tl, tl.move);
  near(st.move, 1);
  near(st.tilt, 0);
  st = V.pourAt(tl, tl.move + tl.tilt);
  near(st.tilt, 1);
  near(st.flow, 0);
  st = V.pourAt(tl, tl.move + tl.tilt + tl.flow / 2);
  assert.ok(Math.abs(st.flow - 0.5) < 1e-9);
  near(st.tilt, 1, 'tilted while flowing');
  st = V.pourAt(tl, tl.move + tl.tilt + tl.flow + tl.back / 2);
  near(st.flow, 1);
  assert.ok(st.tilt > 0 && st.tilt < 1, 'tilting back');
  st = V.pourAt(tl, tl.total);
  assert.equal(st.done, true);
  near(st.back, 1);
  near(st.tilt, 0);
  assert.equal(V.pourAt(tl, -1).move, 0, 'clamped before the start');
});

test('easing curves stay in [0, 1] and hit the ends', () => {
  for (const f of [V.easeOut, V.easeInOut]) {
    assert.equal(f(0), 0);
    assert.equal(f(1), 1);
    for (let x = 0; x <= 1; x += 0.1) assert.ok(f(x) >= 0 && f(x) <= 1);
  }
  assert.equal(V.clamp(5, 0, 1), 1);
  assert.equal(V.clamp(-5, 0, 1), 0);
});

test('12 distinct colours, each with its own pattern', () => {
  assert.equal(V.PALETTE.length, 12);
  assert.equal(new Set(V.PALETTE.map((p) => p.color)).size, 12);
  assert.equal(new Set(V.PALETTE.map((p) => p.pattern)).size, 12);
  for (const p of V.PALETTE) assert.match(p.color, /^#[0-9a-f]{6}$/);
});

test('shade lightens and darkens', () => {
  assert.equal(V.shade('#808080', 0), '#808080');
  assert.equal(V.shade('#000000', 1), '#ffffff');
  assert.equal(V.shade('#ffffff', -1), '#000000');
  assert.equal(V.shade('#204060', 0.5), '#90a0b0');
});
