'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { poissonPmf, poissonUpperTail, goalsCutoff } = require('../../src/domain/model/poisson');
const { buildScoreMatrix } = require('../../src/domain/model/scoreMatrix');
const { marketProbabilities, fairOdds, fairOddsDnb } = require('../../src/domain/model/markets');
const { devig, doubleChanceFrom1x2, dnbConditional, expectedValue, expectedValueDnb, impliedProbability } = require('../../src/domain/odds');
const { defaultConfig } = require('../../src/domain/model/config');

const CFG = defaultConfig();
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);
const GRID = [];
for (let h = 0.2; h <= 4.5 + 1e-9; h += 0.43) for (let a = 0.2; a <= 4.5 + 1e-9; a += 0.43) GRID.push([h, a]);

function scored(lh, la) {
  const s = buildScoreMatrix(lh, la, CFG);
  return { s, p: marketProbabilities(s, lh, la, CFG.ouLines) };
}

test('§15.1 Poisson pmf reference values (λ = 1.5)', () => {
  const p = poissonPmf(1.5, 2);
  close(p[0], 0.22313016, 1e-8);
  close(p[1], 0.33469524, 1e-8);
  close(p[2], 0.25102143, 1e-8);
  assert.throws(() => poissonPmf(0, 3));
  assert.throws(() => poissonPmf(Number.NaN, 3));
});

test('§15.2 matrix mass is 1 − ε with ε < 1e-11 across λ ∈ [0.2, 4.5]', () => {
  for (const [lh, la] of GRID) {
    const { s } = scored(lh, la);
    assert.ok(s, `matrix built for ${lh}, ${la}`);
    assert.ok(s.epsilon < 1e-11 && s.epsilon > -1e-12, `ε=${s.epsilon} at ${lh}, ${la}`);
  }
  assert.equal(goalsCutoff(4.5, 1e-12, 30), 26); // why the spec's original cap of 15 was too low
  assert.ok(poissonUpperTail(4.5, 15) > 1e-6);
});

test('§15.3 P(H)+P(D)+P(A)+ε = 1', () => {
  for (const [lh, la] of GRID) {
    const { s, p } = scored(lh, la);
    close(p['1X2'].HOME + p['1X2'].DRAW + p['1X2'].AWAY + s.epsilon, 1, 1e-12);
  }
});

test('§15.4 Double Chance identity: 1X + 12 + X2 = 2(1 − ε)', () => {
  for (const [lh, la] of GRID) {
    const { s, p } = scored(lh, la);
    close(p.DC['1X'] + p.DC['12'] + p.DC.X2, 2 * (1 - s.epsilon), 1e-12);
  }
});

test('§15.5 Over + Under = 1; matrix CDF equals Poisson CDF of the total', () => {
  for (const [lh, la] of GRID) {
    const { p } = scored(lh, la);
    const total = poissonPmf(lh + la, 3);
    for (const line of CFG.ouLines) {
      const ou = p.OU[line];
      close(ou.OVER + ou.UNDER, 1, 1e-15);
      let cdf = 0;
      for (let t = 0; t <= Math.floor(line); t += 1) cdf += total[t];
      close(ou.UNDER, cdf, 1e-10, `line ${line}`);
    }
  }
});

test('§15.6 BTTS closed form equals matrix sum over h ≥ 1, a ≥ 1', () => {
  for (const [lh, la] of GRID) {
    const { s, p } = scored(lh, la);
    let sum = 0;
    for (let h = 1; h <= s.g; h += 1) for (let a = 1; a <= s.g; a += 1) sum += s.matrix[h][a];
    close(p.BTTS.YES, sum, 1e-10);
  }
});

test('§15.7 symmetry: λH = λA ⇒ P(H) = P(A)', () => {
  for (const l of [0.3, 1.1, 1.4, 2.7, 4.4]) {
    const { p } = scored(l, l);
    close(p['1X2'].HOME, p['1X2'].AWAY, 1e-15);
  }
});

test('§15.8 monotonicity: higher λH raises P(H) and P(Over 2.5)', () => {
  let prev = scored(0.5, 1.3).p;
  for (let lh = 0.6; lh <= 4.4; lh += 0.1) {
    const cur = scored(lh, 1.3).p;
    assert.ok(cur['1X2'].HOME > prev['1X2'].HOME);
    assert.ok(cur.OU[2.5].OVER > prev.OU[2.5].OVER);
    prev = cur;
  }
});

test('§15.9 fair odds × p = 1; DNB fair odds give EV = 0', () => {
  for (const p of [0.02, 0.1, 0.5, 0.93]) close(fairOdds(p, 0.02) * p, 1, 1e-15);
  assert.equal(fairOdds(0.019, 0.02), null);
  const dnb = { win: 0.45, push: 0.27, loss: 0.28 };
  close(expectedValueDnb(dnb, fairOddsDnb(dnb, 0.02)), 0, 1e-15);
});

test('§15.10 EV worked examples', () => {
  close(expectedValue(0.55, 2.0), 0.1, 1e-15);
  close(expectedValueDnb({ win: 0.5, loss: 0.3 }, 1.7), 0.05, 1e-15);
});

test('§15.11 de-vig: complete sets sum to 1, incomplete refused, DC never normalized', () => {
  const r = devig('1X2', { HOME: 2.1, DRAW: 3.4, AWAY: 3.6 });
  assert.equal(r.complete, true);
  close(r.pFair.HOME + r.pFair.DRAW + r.pFair.AWAY, 1, 1e-15);
  close(r.overround, 1 / 2.1 + 1 / 3.4 + 1 / 3.6 - 1, 1e-15);
  assert.deepEqual(devig('1X2', { HOME: 2.1, DRAW: 3.4 }), { complete: false, reason: 'MARKET_INCOMPLETE' });
  assert.deepEqual(devig('DC', { '1X': 1.3, 12: 1.3, X2: 1.8 }), { complete: false, reason: 'DC_NOT_NORMALIZABLE' });
  const dc = doubleChanceFrom1x2(r.pFair);
  close(dc['1X'] + dc['12'] + dc.X2, 2, 1e-15);
  close(dnbConditional({ win: 0.45, loss: 0.3 }), 0.6, 1e-15);
  const ou = devig('OU', { OVER: 1.9, UNDER: 1.95 });
  close(ou.pFair.OVER + ou.pFair.UNDER, 1, 1e-15);
});

test('§15.12 invalid odds are rejected', () => {
  for (const bad of [1, 0.5, -2, Number.NaN, Number.POSITIVE_INFINITY, '2.0', null, undefined]) {
    assert.throws(() => impliedProbability(bad));
    assert.throws(() => expectedValue(0.5, bad));
  }
  assert.equal(devig('BTTS', { YES: 1.0, NO: 1.9 }).reason, 'MARKET_INCOMPLETE');
});
