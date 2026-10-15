'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { leagueBaseline, teamStrength, byRecency } = require('../../src/domain/model/strengths');
const { estimate } = require('../../src/domain/model/estimate');
const { defaultConfig } = require('../../src/domain/model/config');
const { syntheticLeague } = require('./synthetic');

function pearson(x, y) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

test('§15.16 simulation recovery: strengths approach the truth as the sample grows', () => {
  // 10 seasons from the model's own generative process; true strengths are known.
  const L = syntheticLeague({ teams: 20, seasons: 10, seed: 2026, spread: 0.3 });
  const sorted = [...L.matches].sort(byRecency);
  const errors = {};
  for (const nTeam of [10, 38, 190]) {
    const baseline = leagueBaseline(sorted);
    const est = L.ids.map((id) => teamStrength(id, sorted.filter((m) => m.homeTeamId === id || m.awayTeamId === id).slice(0, nTeam), baseline, 0));
    // Ratios are relative to the league average, so compare after normalizing the truth to mean 1.
    const meanA = L.ids.reduce((s, id) => s + L.alpha[id], 0) / L.ids.length;
    const trueA = L.ids.map((id) => L.alpha[id] / meanA);
    const estA = est.map((e) => e.rAtt);
    errors[nTeam] = trueA.reduce((s, t, i) => s + Math.abs(t - estA[i]), 0) / L.ids.length;
    if (nTeam === 190) assert.ok(pearson(trueA, estA) > 0.9, `correlation ${pearson(trueA, estA)}`);
  }
  assert.ok(errors[190] < errors[38] && errors[38] < errors[10], JSON.stringify(errors));
  assert.ok(errors[190] < 0.06, JSON.stringify(errors));
});

test('§15.16 shrinkage reduces error for small samples', () => {
  const L = syntheticLeague({ teams: 20, seasons: 4, seed: 11, spread: 0.2 });
  const sorted = [...L.matches].sort(byRecency);
  const baseline = leagueBaseline(sorted);
  const meanA = L.ids.reduce((s, id) => s + L.alpha[id], 0) / L.ids.length;
  const mae = (k) =>
    L.ids.reduce((s, id) => {
      const e = teamStrength(id, sorted.filter((m) => m.homeTeamId === id || m.awayTeamId === id).slice(0, 6), baseline, k);
      return s + Math.abs(L.alpha[id] / meanA - e.alpha);
    }, 0) / L.ids.length;
  assert.ok(mae(8) < mae(0), `k=8: ${mae(8)} vs k=0: ${mae(0)}`);
});

test('§15.17 (synthetic) predicted mean total goals matches the observed mean', () => {
  const L = syntheticLeague({ teams: 20, seasons: 3, seed: 5 });
  const cfg = defaultConfig();
  const test = L.matches.filter((m) => m.season === L.matches.at(-1).season).slice(-190);
  let predicted = 0;
  let observed = 0;
  let n = 0;
  for (const m of test) {
    const asOf = new Date(Date.parse(m.kickoffUtc) - 3600000).toISOString();
    const r = estimate({ fixture: m, history: L.matches, asOf, config: cfg });
    if (r.status !== 'OK') continue;
    predicted += r.lambdas.home + r.lambdas.away;
    observed += m.homeGoals + m.awayGoals;
    n += 1;
  }
  const se = Math.sqrt((2.7 / n)); // Poisson variance ≈ mean total
  assert.ok(n > 150);
  assert.ok(Math.abs(predicted / n - observed / n) < 1.96 * se, `pred ${predicted / n} obs ${observed / n}`);
});
