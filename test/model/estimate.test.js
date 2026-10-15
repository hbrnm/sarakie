'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { estimate } = require('../../src/domain/model/estimate');
const { defaultConfig, configHash, PARAMETERS, canonicalJson } = require('../../src/domain/model/config');
const { syntheticLeague, mulberry32 } = require('./synthetic');

const league = syntheticLeague({ teams: 20, seasons: 2, seed: 7 }); // seasons 2024, 2025: 760 matches
const lastMs = Date.parse(league.lastKickoff);
const fixture = (over = {}) => ({
  competitionCode: 'EPL', season: 2025, kickoffUtc: new Date(lastMs + 7 * 86400000).toISOString(), homeTeamId: 'T01', awayTeamId: 'T02', ...over,
});
const asOf = new Date(lastMs + 6 * 86400000).toISOString();

test('a well-supported fixture yields an OK estimate with versioning and diagnostics', () => {
  const r = estimate({ fixture: fixture(), history: league.matches, asOf });
  assert.equal(r.status, 'OK');
  assert.equal(r.modelFamily, 'poisson-independent');
  assert.equal(r.modelVersion, '1.0.0');
  assert.match(r.configHash, /^[0-9a-f]{64}$/);
  assert.equal(r.diagnostics.leagueSample, 380);
  assert.equal(r.diagnostics.home.n, 38);
  assert.ok(r.lambdas.home > 0.2 && r.lambdas.home < 4.5);
  assert.ok(Math.abs(r.diagnostics.muHome - 1.5) < 0.2);
  const m = r.markets;
  assert.ok(Math.abs(m['1X2'].HOME.p * m['1X2'].HOME.fairOdds - 1) < 1e-12);
  assert.equal(Object.keys(m.OU).sort().join(','), '1.5,2.5,3.5');
  assert.ok(m.DNB.HOME.push > 0 && m.DNB.HOME.fairOdds > 1);
});

test('§15.13 determinism: identical output for repeated runs and any input order', () => {
  const a = canonicalJson(estimate({ fixture: fixture(), history: league.matches, asOf }));
  const b = canonicalJson(estimate({ fixture: fixture(), history: league.matches, asOf }));
  const rng = mulberry32(99);
  const shuffled = [...league.matches].map((m) => [rng(), m]).sort((x, y) => x[0] - y[0]).map(([, m]) => m);
  const c = canonicalJson(estimate({ fixture: fixture(), history: shuffled, asOf }));
  assert.equal(a, b);
  assert.equal(a, c);
});

test('§15.14 leakage guard: matches at/after asOf are ignored; asOf after kickoff is refused', () => {
  const base = canonicalJson(estimate({ fixture: fixture(), history: league.matches, asOf }));
  const future = [
    { competitionCode: 'EPL', season: 2025, kickoffUtc: asOf, homeTeamId: 'T01', awayTeamId: 'T02', homeGoals: 9, awayGoals: 0, status: 'FINISHED' },
    { competitionCode: 'EPL', season: 2025, kickoffUtc: fixture().kickoffUtc, homeTeamId: 'T01', awayTeamId: 'T02', homeGoals: 7, awayGoals: 7, status: 'FINISHED' },
  ];
  assert.equal(canonicalJson(estimate({ fixture: fixture(), history: [...league.matches, ...future], asOf })), base);
  assert.throws(() => estimate({ fixture: fixture(), history: league.matches, asOf: new Date(lastMs + 8 * 86400000).toISOString() }), /future information/);
});

test('§15.15 config hash changes whenever any parameter changes', () => {
  const h0 = configHash(defaultConfig());
  assert.equal(configHash(defaultConfig()), h0);
  for (const key of Object.keys(PARAMETERS)) {
    const c = defaultConfig();
    c[key] = Array.isArray(c[key]) ? [...c[key], 4.5] : c[key] + 1;
    assert.notEqual(configHash(c), h0, key);
  }
  assert.ok(Object.values(PARAMETERS).every((p) => ['EMPIRICAL', 'PROVISIONAL', 'PROVIDER', 'AWAITING_VALIDATION'].includes(p.class)));
});

test('gates: league baseline sample', () => {
  const r = estimate({ fixture: fixture(), history: league.matches.slice(-100), asOf });
  assert.equal(r.status, 'INSUFFICIENT_DATA');
  assert.ok(r.reasons.includes('LEAGUE_BASELINE_SAMPLE'));
});

test('gates: promoted team without history vs. established team with too few matches', () => {
  const newcomer = estimate({ fixture: fixture({ awayTeamId: 'PROMOTED' }), history: league.matches, asOf });
  assert.deepEqual(newcomer.reasons, ['PROMOTED_TEAM_NO_HISTORY']);
  const after5 = [...league.matches];
  for (let i = 0; i < 5; i += 1) {
    after5.push({ competitionCode: 'EPL', season: 2025, kickoffUtc: new Date(lastMs + (i + 1) * 3600000).toISOString(), homeTeamId: 'PROMOTED', awayTeamId: `T1${i}`, homeGoals: 1, awayGoals: 1, status: 'FINISHED' });
  }
  const promotedOk = estimate({ fixture: fixture({ awayTeamId: 'PROMOTED' }), history: after5, asOf });
  assert.equal(promotedOk.status, 'OK'); // 5 current-season matches meet both minima; shrinkage pulls toward average
  assert.ok(Math.abs(promotedOk.diagnostics.away.alpha - 1) < Math.abs(promotedOk.diagnostics.away.rAtt - 1) + 1e-12);
});

test('gates: current-season minimum unless the team has a full window from last season', () => {
  // Season 2026 fixture before any 2026 match: T01 has 38 matches from 2025, so the fallback applies.
  const r = estimate({ fixture: fixture({ season: 2026 }), history: league.matches, asOf });
  assert.equal(r.status, 'OK');
  // A team with only 10 matches, none in the current season, is refused.
  const thin = league.matches.filter((m) => !(m.homeTeamId === 'T03' || m.awayTeamId === 'T03') || (m.season === 2024 && m.kickoffUtc < league.matches[300].kickoffUtc));
  const n = thin.filter((m) => m.homeTeamId === 'T03' || m.awayTeamId === 'T03').length;
  assert.ok(n >= 5 && n < 38);
  const t3 = estimate({ fixture: fixture({ homeTeamId: 'T03' }), history: thin, asOf });
  assert.deepEqual(t3.reasons, ['TEAM_SAMPLE_CURRENT_SEASON']);
});

test('gates: UEFA competitions are not model-applicable (D-13)', () => {
  const r = estimate({ fixture: fixture({ competitionCode: 'UCL' }), history: league.matches, asOf });
  assert.deepEqual(r.reasons, ['MODEL_NOT_APPLICABLE_CROSS_LEAGUE']);
});

test('gates: λ outside the applicability range', () => {
  const cfg = { ...defaultConfig(), lambdaMax: 0.5 };
  const r = estimate({ fixture: fixture(), history: league.matches, asOf, config: cfg });
  assert.deepEqual(r.reasons, ['LAMBDA_OUT_OF_RANGE']);
  assert.ok(r.lambdas.home > 0.5 || r.lambdas.away > 0.5);
});

test('§7 missing data: unfinished or scoreless records are excluded and counted, not imputed', () => {
  const dirty = [
    ...league.matches,
    { competitionCode: 'EPL', season: 2025, kickoffUtc: new Date(lastMs - 1000).toISOString(), homeTeamId: 'T01', awayTeamId: 'T02', homeGoals: null, awayGoals: null, status: 'POSTPONED' },
    { competitionCode: 'EPL', season: 2025, kickoffUtc: new Date(lastMs - 2000).toISOString(), homeTeamId: 'T01', awayTeamId: 'T02', homeGoals: -1, awayGoals: 2, status: 'FINISHED' },
    { competitionCode: 'SERIEA', season: 2025, kickoffUtc: new Date(lastMs - 3000).toISOString(), homeTeamId: 'T01', awayTeamId: 'T02', homeGoals: 5, awayGoals: 5, status: 'FINISHED' },
  ];
  const clean = estimate({ fixture: fixture(), history: league.matches, asOf });
  const r = estimate({ fixture: fixture(), history: dirty, asOf });
  assert.equal(r.diagnostics.excludedMatches, 2);
  assert.deepEqual(r.lambdas, clean.lambdas);
});

test('identical teams and invalid asOf are refused', () => {
  assert.throws(() => estimate({ fixture: fixture({ awayTeamId: 'T01' }), history: league.matches, asOf }));
  assert.throws(() => estimate({ fixture: fixture(), history: league.matches, asOf: 'yesterday' }));
});
