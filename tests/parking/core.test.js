'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../web/parking/core.js');

// A 6×6 board from rows; extra fields (vehicles, optimal) are merged in.
const game = (rows, extra) => P.newGame({ rows, optimal: 3, ...extra });
const at = (state, id) => {
  const v = state.vehicles.find((c) => c.id === id);
  return [v.x, v.y];
};

const OPEN = [
  '......',
  '..A...',
  'XXA...',
  '......',
  'BB...C',
  '.....C',
];

test('parseLevel reads size, exit row, vehicles and kinds', () => {
  const L = P.parseLevel({ rows: ['..T...', '..T...', 'XXT#..', '......', 'BBB.|.', '......'], vehicles: { T: 'tow' } });
  assert.equal(L.w, 6);
  assert.equal(L.h, 6);
  assert.equal(L.exitRow, 2);
  assert.equal(L.optimal, null);
  assert.deepEqual(L.vehicles.map((v) => [v.id, v.kind, v.dir, v.len, v.x, v.y]), [
    ['B', 'bus', 'h', 3, 0, 4],
    ['T', 'tow', 'v', 3, 2, 0],
    ['X', 'car', 'h', 2, 0, 2],
  ]);
  assert.equal(L.cells[2 * 6 + 3], '#');
  assert.equal(L.cells[4 * 6 + 4], '|');
  assert.equal(L.cells[0], '.');
  assert.equal(L.cells[2], '.', 'vehicle cells are stored empty');
  assert.deepEqual(P.toRows(L), ['..T...', '..T...', 'XXT#..', '......', 'BBB.|.', '......']);
  // {kind, dir} form and explicit car/bus are accepted too
  const L2 = P.parseLevel({ rows: OPEN, vehicles: { A: { kind: 'car', dir: 'v' }, B: 'car' }, optimal: 2 });
  assert.equal(L2.optimal, 2);
  assert.deepEqual(P.toRows(P.newGame(L2)), OPEN, 'newGame accepts a parsed level');
});

test('vehicles move only along their axis, any distance, as one move', () => {
  const s = game(OPEN);
  assert.equal(P.canMove(s, 'A', 1), true);   // v: down
  assert.equal(P.canMove(s, 'A', -1), true);  // v: up
  assert.equal(P.canMove(s, 'B', 3), true);   // h: right up to C
  assert.equal(P.canMove(s, 'B', 4), false);  // into C
  assert.equal(P.canMove(s, 'X', -1), false); // wall on the left
  assert.equal(P.canMove(s, 'B', -1), false); // wall on the left
  assert.equal(P.canMove(s, 'B', 0), false);
  assert.equal(P.canMove(s, 'B', 1.5), false);
  assert.equal(P.canMove(s, 'B', '1'), false);
  assert.equal(P.canMove(s, 'Q', 1), false, 'unknown vehicle');
  assert.equal(P.moveRange(s, 'Q'), null);
  assert.deepEqual(P.moveRange(s, 'B'), { min: 0, max: 3, exit: false }, 'C stands at x=5 in row 4');
  assert.equal(P.move(s, 'B', 3), true);
  assert.deepEqual(at(s, 'B'), [3, 4]);
  assert.equal(s.moves, 1);
  assert.equal(P.move(s, 'B', 1), false, 'C blocks');
  assert.equal(s.moves, 1, 'a rejected move costs nothing');
  assert.equal(P.move(s, 'A', -1), true);
  assert.deepEqual(at(s, 'A'), [2, 0]);
  assert.equal(s.moves, 2);
});

test('vehicles, bollards and walls block a slide', () => {
  const s = game(['......', '......', 'XX.A..', '...A#.', '#.....', 'BB....']);
  assert.deepEqual(P.moveRange(s, 'X'), { min: 0, max: 1, exit: false }, 'A blocks X');
  assert.deepEqual(P.moveRange(s, 'A'), { min: -2, max: 2, exit: false }, 'walls top and bottom');
  assert.deepEqual(P.moveRange(s, 'B'), { min: 0, max: 4, exit: false });
  const t = game(['......', '......', 'XX.#..', '......', '.##...', '.BB...']);
  assert.deepEqual(P.moveRange(t, 'X'), { min: 0, max: 1, exit: false }, 'a bollard blocks X');
  assert.deepEqual(P.moveRange(t, 'B'), { min: -1, max: 3, exit: false });
});

test('a barrier is closed on odd moves and open on even ones', () => {
  const s = game(['......', '......', 'XX.|..', '......', 'A.....', 'A.....']);
  assert.equal(P.gateOpen(s), false, 'move 1 is odd: closed');
  assert.equal(P.gateClosed(0), true);
  assert.equal(P.gateClosed(1), false);
  assert.deepEqual(P.moveRange(s, 'X'), { min: 0, max: 1, exit: false });
  assert.equal(P.canMove(s, 'X', 2), false, 'cannot stop on a closed barrier');
  assert.equal(P.canMove(s, 'X', 4), false, 'cannot pass a closed barrier');
  assert.equal(P.move(s, 'A', -1), true);
  assert.equal(P.gateOpen(s), true, 'move 2 is even: open');
  assert.equal(P.canMove(s, 'X', 2), true, 'may stop on an open barrier');
  assert.equal(P.move(s, 'X', 2), true);
  assert.deepEqual(at(s, 'X'), [2, 2]);
  assert.equal(P.gateOpen(s), false, 'move 3: closed again');
  // standing on the closed barrier is fine, and so is driving off it
  assert.equal(P.canMove(s, 'X', 2), true);
  assert.equal(P.move(s, 'X', 2), true);
  assert.deepEqual(at(s, 'X'), [4, 2]);
  assert.equal(P.canMove(s, 'X', -1), true, 'move 4 is even: may back onto the open barrier');
  assert.equal(P.move(s, 'A', 1), true);
  assert.equal(P.canMove(s, 'X', -1), false, 'move 5 is odd: the barrier is closed');
});

test('a vertical vehicle meets a barrier the same way', () => {
  const s = game(['A.....', 'A.....', '|.....', '......', 'XX....', '......']);
  assert.deepEqual(P.moveRange(s, 'A'), { min: 0, max: 0, exit: false });
  P.move(s, 'X', 1);
  assert.deepEqual(P.moveRange(s, 'A'), { min: 0, max: 4, exit: false });
});

test('a tow truck moves at most one cell per move', () => {
  const s = game(['......', '......', 'XX....', '......', 'TT....', '......'], { vehicles: { T: 'tow' } });
  assert.deepEqual(P.moveRange(s, 'T'), { min: 0, max: 1, exit: false });
  assert.equal(P.canMove(s, 'T', 2), false);
  assert.equal(P.move(s, 'T', 1), true);
  assert.deepEqual(P.moveRange(s, 'T'), { min: -1, max: 1, exit: false });
  const v = game(['......', '..T...', 'XXT...', '..T...', '......', '......'], { vehicles: { T: 'tow' } });
  assert.deepEqual(P.moveRange(v, 'T'), { min: -1, max: 1, exit: false });
  assert.equal(P.canMove(v, 'T', -1), true);
  assert.equal(P.canMove(v, 'T', 2), false);
});

test('the player leaves through the exit with one move; the tail passes the edge', () => {
  const s = game(['......', '......', 'XX....', '......', '......', '......'], { optimal: 1 });
  assert.deepEqual(P.moveRange(s, 'X'), { min: 0, max: 4, exit: true });
  assert.equal(P.canMove(s, 'X', 4), true, 'to the edge is an ordinary move');
  assert.equal(P.canMove(s, 'X', 5), true, 'past the edge is the exit');
  assert.equal(P.canMove(s, 'X', 99), true);
  assert.equal(P.move(s, 'X', 5), true);
  assert.equal(s.vehicles.find((v) => v.id === 'X').x, 6, 'x = w once out');
  assert.equal(s.moves, 1);
  assert.equal(s.status, 'won');
  assert.equal(P.status(s), 'won');
  assert.deepEqual(P.toRows(s)[2], '......', 'the car is gone');
  assert.equal(P.move(s, 'X', -1), false, 'no moves after the win');
  assert.equal(P.moveRange(s, 'X'), null);
  // only X may leave
  const t = game(['......', '......', 'XX....', '......', '...BB.', '......']);
  assert.equal(P.moveRange(t, 'B').exit, false);
  assert.equal(P.canMove(t, 'B', 2), false);
});

test('undo restores positions, the counter, the barrier parity and the status', () => {
  const s = game(['......', '......', 'XX.|..', '......', '......', 'BB....'], { optimal: 2 });
  assert.equal(P.undo(s), false, 'nothing to undo');
  const start = JSON.stringify(s);
  assert.equal(P.move(s, 'B', 1), true);
  assert.equal(P.move(s, 'X', 9), true);
  assert.equal(s.status, 'won');
  assert.equal(P.undo(s), true);
  assert.equal(s.status, 'playing');
  assert.equal(s.moves, 1);
  assert.equal(P.gateOpen(s), true);
  assert.deepEqual(at(s, 'X'), [0, 2]);
  assert.equal(P.undo(s), true);
  assert.equal(JSON.stringify(s), start, 'back to the exact start');
  assert.equal(P.gateOpen(s), false);
});

test('the move limit runs out → lost; undo brings the game back', () => {
  const s = game(OPEN, { optimal: 2 });
  assert.equal(s.limit, 7);
  for (let i = 0; i < 6; i++) assert.equal(P.move(s, 'B', i % 2 ? -1 : 1), true);
  assert.equal(s.status, 'playing');
  assert.equal(P.move(s, 'B', 1), true);
  assert.equal(s.moves, 7);
  assert.equal(s.status, 'lost');
  assert.equal(P.move(s, 'B', -1), false, 'no moves once lost');
  assert.equal(P.undo(s), true);
  assert.equal(s.status, 'playing');
  assert.equal(s.moves, 6);
  // a win on the last allowed move is still a win
  P.move(s, 'A', 3);
  assert.equal(s.status, 'lost');
  P.undo(s);
  P.move(s, 'A', -1);
  assert.equal(s.status, 'lost', 'X is still blocked after A goes up one');
  P.undo(s);
  const t = game(['......', '......', 'XX....', '......', 'BB....', '......'], { optimal: 1 });
  for (let i = 0; i < 5; i++) P.move(t, 'B', i % 2 ? -1 : 1);
  assert.equal(P.move(t, 'X', 4 + 1), true);
  assert.equal(t.moves, 6);
  assert.equal(t.status, 'won', 'won on the limit');
});

test('limit and stars follow the rules at the boundaries', () => {
  assert.equal(P.limitFor(1), 6);
  assert.equal(P.limitFor(2), 7);
  assert.equal(P.limitFor(10), 15);
  assert.equal(P.limitFor(11), 17);
  assert.equal(P.limitFor(20), 30);
  assert.equal(P.stars(10, 10), 3);
  assert.equal(P.stars(9, 10), 3);
  assert.equal(P.stars(11, 10), 2);
  assert.equal(P.stars(13, 10), 2);
  assert.equal(P.stars(14, 10), 1);
  assert.equal(P.stars(15, 10), 1);
  assert.equal(P.stars(16, 10), 0);
  assert.equal(P.stars(2, 2), 3);
  assert.equal(P.stars(5, 2), 2);
  assert.equal(P.stars(7, 2), 1);
  assert.equal(P.stars(8, 2), 0);
  for (const junk of [[-1, 3], [1.5, 3], [3, 0], [3, null], ['3', 3], [NaN, 3]]) assert.equal(P.stars(...junk), 0);
});

test('newGame computes the optimum when the level has none; restart resets', () => {
  const s = P.newGame({ rows: OPEN });
  assert.equal(s.optimal, 2);
  assert.equal(s.limit, 7);
  P.move(s, 'A', 2);
  P.restart(s);
  assert.equal(s.moves, 0);
  assert.equal(s.history.length, 0);
  assert.deepEqual(P.toRows(s), OPEN);
  assert.equal(s.optimal, 2);
  assert.throws(() => P.newGame({ rows: ['......', '......', 'XX..BB', '......', '......', '......'] }), /no solution/);
});

test('the state is plain data: a JSON round trip keeps playing', () => {
  const s = game(OPEN, { optimal: 2 });
  P.move(s, 'A', 2);
  const r = JSON.parse(JSON.stringify(s));
  assert.equal(P.undo(r), true);
  assert.equal(P.move(r, 'A', 3), true);
  assert.equal(P.move(r, 'X', 9), true);
  assert.equal(r.status, 'won');
});
