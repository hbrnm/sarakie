'use strict';

const { MODEL_FAMILY, MODEL_VERSION, defaultConfig, configHash } = require('./config');
const { byRecency, leagueBaseline, teamStrength } = require('./strengths');
const { buildScoreMatrix } = require('./scoreMatrix');
const { marketProbabilities, fairOdds, fairOddsDnb } = require('./markets');
const { getCompetition } = require('../competitions');

/**
 * Independent Poisson estimate for one fixture (docs/04-quantitative-model-spec.md).
 * Pure and deterministic: the same fixture, history, asOf and config give byte-identical output.
 *
 * Leakage guard: only matches with kickoff strictly before `asOf` are used, and `asOf` may not
 * be after the fixture's kickoff.
 *
 * @param {{
 *   fixture: { competitionCode: string, season: number, kickoffUtc: string, homeTeamId: string, awayTeamId: string },
 *   history: import('./strengths').ModelMatch[] & { status?: string }[],
 *   asOf: string,
 *   config?: ReturnType<typeof defaultConfig>,
 * }} input
 */
function estimate({ fixture, history, asOf, config = defaultConfig() }) {
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) throw new RangeError('asOf must be an ISO timestamp');
  if (asOfMs > Date.parse(fixture.kickoffUtc)) throw new RangeError('asOf is after kickoff: prediction would use future information');
  if (fixture.homeTeamId === fixture.awayTeamId) throw new RangeError('home and away team are identical');

  const reasons = [];
  const base = {
    modelFamily: MODEL_FAMILY,
    modelVersion: MODEL_VERSION,
    configHash: configHash(config),
    asOf: new Date(asOfMs).toISOString(),
  };

  if (!getCompetition(fixture.competitionCode).modelApplicable) {
    return { ...base, status: 'INSUFFICIENT_DATA', reasons: ['MODEL_NOT_APPLICABLE_CROSS_LEAGUE'], diagnostics: {} };
  }

  // Missing-data behaviour (spec §7): unusable records are excluded and counted, never imputed.
  let excluded = 0;
  const usable = [];
  for (const m of history) {
    if (m.competitionCode !== fixture.competitionCode) continue;
    if (!(Date.parse(m.kickoffUtc) < asOfMs)) continue;
    const ok =
      (m.status === undefined || m.status === 'FINISHED') &&
      Number.isInteger(m.homeGoals) && m.homeGoals >= 0 &&
      Number.isInteger(m.awayGoals) && m.awayGoals >= 0 &&
      m.homeTeamId && m.awayTeamId && m.homeTeamId !== m.awayTeamId;
    if (ok) usable.push(m);
    else excluded += 1;
  }
  usable.sort(byRecency);

  const leagueWindow = usable.slice(0, config.nLeague);
  const baseline = leagueBaseline(leagueWindow);
  if (baseline.n < config.nLeagueMin) reasons.push('LEAGUE_BASELINE_SAMPLE');
  else if (!(baseline.muHome > 0) || !(baseline.muAway > 0)) reasons.push('LEAGUE_BASELINE_DEGENERATE');

  const side = (teamId) => {
    const all = usable.filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId);
    const window = all.slice(0, config.nTeam);
    const current = window.filter((m) => m.season === fixture.season).length;
    const hasPriorSeason = all.some((m) => m.season < fixture.season);
    if (window.length < config.nTeamMin) reasons.push(hasPriorSeason ? 'TEAM_SAMPLE' : 'PROMOTED_TEAM_NO_HISTORY');
    else if (current < config.nCurMin && window.length < config.nTeam) reasons.push('TEAM_SAMPLE_CURRENT_SEASON');
    return { window, current };
  };
  const h = side(fixture.homeTeamId);
  const a = side(fixture.awayTeamId);

  const diagnostics = {
    leagueSample: baseline.n,
    muHome: baseline.muHome,
    muAway: baseline.muAway,
    homeAdvantage: baseline.muAway > 0 ? baseline.muHome / baseline.muAway : null,
    excludedMatches: excluded,
    home: { n: h.window.length, currentSeason: h.current },
    away: { n: a.window.length, currentSeason: a.current },
    dataCutoffUtc: usable.length ? new Date(Date.parse(usable[0].kickoffUtc)).toISOString() : null,
  };
  if (reasons.length) return { ...base, status: 'INSUFFICIENT_DATA', reasons: [...new Set(reasons)], diagnostics };

  const sh = teamStrength(fixture.homeTeamId, h.window, baseline, config.shrinkageK);
  const sa = teamStrength(fixture.awayTeamId, a.window, baseline, config.shrinkageK);
  Object.assign(diagnostics.home, { rAtt: sh.rAtt, rDef: sh.rDef, alpha: sh.alpha, delta: sh.delta });
  Object.assign(diagnostics.away, { rAtt: sa.rAtt, rDef: sa.rDef, alpha: sa.alpha, delta: sa.delta });

  // Spec §5: λH = μh · αH · δA, λA = μa · αA · δH.
  const lambdaHome = baseline.muHome * sh.alpha * sa.delta;
  const lambdaAway = baseline.muAway * sa.alpha * sh.delta;
  const lambdas = { home: lambdaHome, away: lambdaAway };
  const inRange = (l) => l >= config.lambdaMin && l <= config.lambdaMax;
  if (!inRange(lambdaHome) || !inRange(lambdaAway)) {
    return { ...base, status: 'INSUFFICIENT_DATA', reasons: ['LAMBDA_OUT_OF_RANGE'], lambdas, diagnostics };
  }
  const scores = buildScoreMatrix(lambdaHome, lambdaAway, config);
  if (!scores) return { ...base, status: 'INSUFFICIENT_DATA', reasons: ['LAMBDA_OUT_OF_RANGE'], lambdas, diagnostics };
  diagnostics.g = scores.g;
  diagnostics.epsilon = scores.epsilon;

  const p = marketProbabilities(scores, lambdaHome, lambdaAway, config.ouLines);
  const withOdds = (probs) => Object.fromEntries(Object.entries(probs).map(([s, v]) => [s, { p: v, fairOdds: fairOdds(v, config.pFloor) }]));
  const markets = {
    '1X2': withOdds(p['1X2']),
    DC: withOdds(p.DC),
    DNB: Object.fromEntries(Object.entries(p.DNB).map(([s, v]) => [s, { ...v, fairOdds: fairOddsDnb(v, config.pFloor) }])),
    OU: Object.fromEntries(Object.entries(p.OU).map(([line, v]) => [line, withOdds(v)])),
    BTTS: withOdds(p.BTTS),
  };
  return { ...base, status: 'OK', reasons: [], lambdas, markets, diagnostics };
}

module.exports = { estimate };
