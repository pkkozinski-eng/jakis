import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMatch, outcome } from '../src/scoring.js';

const cases = [
  // [typ, wynik, oczekiwane pkt, opis]
  [[2, 1], [2, 1], 5, 'dokladny wynik'],
  [[3, 2], [2, 1], 3, 'rezultat + roznica'],
  [[1, 0], [2, 1], 3, 'rezultat + roznica'],
  [[2, 1], [2, 0], 3, 'rezultat + bramki gospodarza'],
  [[1, 1], [2, 2], 3, 'remis + roznica 0'],
  [[1, 1], [1, 1], 5, 'dokladny remis'],
  [[2, 0], [0, 2], 0, 'kompletne pudlo'],
];

for (const [pred, res, expected, desc] of cases) {
  test(`${pred[0]}:${pred[1]} -> ${res[0]}:${res[1]} = ${expected} pkt (${desc})`, () => {
    const r = scoreMatch({ home: pred[0], away: pred[1] }, { home: res[0], away: res[1] });
    assert.equal(r.points, expected);
  });
}

test('dokladny wynik oznacza exact=true i 5 pkt', () => {
  const r = scoreMatch({ home: 3, away: 3 }, { home: 3, away: 3 });
  assert.equal(r.exact, true);
  assert.equal(r.points, 5);
});

test('correctResult flaga', () => {
  assert.equal(scoreMatch({ home: 5, away: 0 }, { home: 1, away: 0 }).correctResult, true);
  assert.equal(scoreMatch({ home: 0, away: 1 }, { home: 1, away: 0 }).correctResult, false);
});

test('brak typu = 0 pkt', () => {
  assert.equal(scoreMatch(null, { home: 1, away: 0 }).points, 0);
});

test('outcome', () => {
  assert.equal(outcome(2, 1), 'H');
  assert.equal(outcome(1, 1), 'D');
  assert.equal(outcome(0, 2), 'A');
});
