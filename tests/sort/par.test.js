'use strict';
// Re-solves the levels and checks the stored par is still the optimum. Its own file so `node --test` runs it in
// parallel with the rest. Levels 1–40 and every 5th of 41–60 (the plan's rule; in practice all of them are fast).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../web/sort/core.js');
const { LEVELS } = require('../../web/sort/levels.js');

const checked = LEVELS.map((l, i) => i).filter((i) => i < 40 || (i + 1) % 5 === 0);

test('A* confirms the stored par', () => {
  assert.ok(checked.length >= 44);
  for (const i of checked) {
    const sol = S.solve(LEVELS[i]);
    assert.ok(sol, `level ${i + 1} solvable`);
    assert.equal(sol.moves, LEVELS[i].par, `level ${i + 1}`);
  }
});
