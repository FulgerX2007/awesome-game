'use strict';
// The shared art kit (web/fx.js): the pure parts — colours, easing, damping, particles, shake, floaters.
const test = require('node:test');
const assert = require('node:assert/strict');
const Fx = require('../../web/fx.js');

test('easing curves start at 0 and end at 1', () => {
  for (const [name, f] of Object.entries(Fx.ease)) {
    if (name === 'pulse') continue;
    assert.ok(Math.abs(f(0)) < 1e-9, `${name}(0)`);
    assert.ok(Math.abs(f(1) - 1) < 1e-9, `${name}(1)`);
  }
  assert.ok(Fx.ease.outBack(0.6) > 1, 'outBack overshoots');
  assert.equal(Fx.ease.pulse(0), 0);
  assert.ok(Math.abs(Fx.ease.pulse(0.5) - 1) < 1e-9);
});

test('damp closes the gap independently of the frame rate', () => {
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) a = Fx.damp(a, 10, 0.9, 1 / 60);
  for (let i = 0; i < 30; i++) b = Fx.damp(b, 10, 0.9, 1 / 30);
  assert.ok(Math.abs(a - 9) < 1e-6, String(a));
  assert.ok(Math.abs(a - b) < 1e-6);
  assert.equal(Fx.damp(3, 10, 0.9, 0), 3, 'no time, no change');
});

test('colours: parse, mix, shade and alpha', () => {
  assert.deepEqual(Fx.parse('#f80'), [255, 136, 0, 1]);
  assert.deepEqual(Fx.parse('rgba(1, 2, 3, .5)'), [1, 2, 3, 0.5]);
  assert.equal(Fx.mix('#000000', '#ffffff', 0.5), 'rgb(127, 127, 127)');
  assert.equal(Fx.withAlpha('#ff0000', 0.25), 'rgba(255, 0, 0, 0.25)');
  const lum = (c) => Fx.parse(c).slice(0, 3).reduce((s, v) => s + v, 0);
  assert.ok(lum(Fx.shade('#5080c0', 0.4)) > lum('#5080c0'));
  assert.ok(lum(Fx.shade('#5080c0', -0.4)) < lum('#5080c0'));
  assert.equal(Fx.shade('#5080c0', 0.4), Fx.shade('#5080c0', 0.4), 'cached and stable');
});

test('particles move, fall, fade out and respect the pool size', () => {
  const P = new Fx.Particles(5);
  P.emit({ x: 0, y: 0, vx: 10, vy: 0, gravity: 100, life: 1 });
  P.update(0.5);
  assert.equal(P.count, 1);
  assert.ok(P.list[0].x > 4 && P.list[0].y > 0);
  P.update(0.6);
  assert.equal(P.count, 0, 'expired');
  let n = 0;
  const rnd = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  P.burst(0, 0, 12, { speed: 50 }, rnd);
  assert.equal(P.count, 5, 'capped at max');
  P.update(NaN);
  assert.equal(P.count, 5, 'junk dt changes nothing');
});

test('shake decays to rest and its offset is bounded', () => {
  const S = new Fx.Shake(8, 2);
  S.add(0.6); S.add(0.6);
  assert.equal(S.trauma, 1);
  for (let i = 0; i < 30; i++) {
    S.update(1 / 60);
    const o = S.offset();
    assert.ok(Math.abs(o.x) <= 8 && Math.abs(o.y) <= 8);
  }
  S.update(1);
  assert.deepEqual(S.offset(), { x: 0, y: 0 });
});

test('floaters live for their lifetime', () => {
  const F = new Fx.Floaters();
  F.add('+1', 0, 0, { life: 0.5 });
  F.update(0.3);
  assert.equal(F.list.length, 1);
  F.update(0.3);
  assert.equal(F.list.length, 0);
});
