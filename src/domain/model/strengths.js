'use strict';

/**
 * League baseline and team strengths (spec §2–§4, §6–§8). Pure functions over normalized
 * history; the caller has already removed anything at or after the prediction time.
 *
 * @typedef {object} ModelMatch
 * @property {string} competitionCode
 * @property {number} season
 * @property {string} kickoffUtc
 * @property {string} homeTeamId
 * @property {string} awayTeamId
 * @property {number} homeGoals
 * @property {number} awayGoals
 */

/** Most recent first; ties broken by team ids so the order never depends on input order. */
function byRecency(a, b) {
  const d = Date.parse(b.kickoffUtc) - Date.parse(a.kickoffUtc);
  if (d !== 0) return d;
  return a.homeTeamId < b.homeTeamId ? -1 : a.homeTeamId > b.homeTeamId ? 1 : a.awayTeamId < b.awayTeamId ? -1 : a.awayTeamId > b.awayTeamId ? 1 : 0;
}

/** μ_h, μ_a over the league window (spec §2). */
function leagueBaseline(window) {
  let home = 0;
  let away = 0;
  for (const m of window) {
    home += m.homeGoals;
    away += m.awayGoals;
  }
  const n = window.length;
  return { n, muHome: n ? home / n : 0, muAway: n ? away / n : 0 };
}

/**
 * Venue-adjusted observed/expected ratios with shrinkage toward 1 (spec §3–§4).
 * @param {string} teamId
 * @param {ModelMatch[]} window team's matches, most recent first
 */
function teamStrength(teamId, window, { muHome, muAway }, k) {
  let goalsFor = 0;
  let goalsAgainst = 0;
  let expFor = 0;
  let expAgainst = 0;
  for (const m of window) {
    const home = m.homeTeamId === teamId;
    goalsFor += home ? m.homeGoals : m.awayGoals;
    goalsAgainst += home ? m.awayGoals : m.homeGoals;
    expFor += home ? muHome : muAway;
    expAgainst += home ? muAway : muHome;
  }
  const n = window.length;
  const rAtt = expFor > 0 ? goalsFor / expFor : 1;
  const rDef = expAgainst > 0 ? goalsAgainst / expAgainst : 1;
  return {
    n,
    rAtt,
    rDef,
    alpha: (n * rAtt + k) / (n + k),
    delta: (n * rDef + k) / (n + k),
  };
}

module.exports = { byRecency, leagueBaseline, teamStrength };
