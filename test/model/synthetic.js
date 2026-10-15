'use strict';

/** Deterministic synthetic leagues for model tests (seeded PRNG, Poisson by inversion). */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePoisson(lambda, rng) {
  const u = rng();
  let p = Math.exp(-lambda);
  let c = p;
  let x = 0;
  while (u > c && x < 50) {
    x += 1;
    p *= lambda / x;
    c += p;
  }
  return x;
}

/**
 * Double round-robin seasons. Team i has attack alpha[i], defence delta[i];
 * λH = muH·αH·δA, λA = muA·αA·δH — the model's own generative assumptions.
 */
function syntheticLeague({ teams = 20, seasons = 2, seed = 1, muH = 1.5, muA = 1.2, competitionCode = 'EPL', startSeason = 2024, spread = 0.25 }) {
  const rng = mulberry32(seed);
  const ids = Array.from({ length: teams }, (_, i) => `T${String(i + 1).padStart(2, '0')}`);
  const alpha = Object.fromEntries(ids.map((id) => [id, Math.exp((rng() - 0.5) * 2 * spread)]));
  const delta = Object.fromEntries(ids.map((id) => [id, Math.exp((rng() - 0.5) * 2 * spread)]));
  const matches = [];
  let t = Date.UTC(startSeason, 7, 1, 14);
  for (let s = 0; s < seasons; s += 1) {
    for (const home of ids) {
      for (const away of ids) {
        if (home === away) continue;
        t += 3 * 3600 * 1000;
        matches.push({
          competitionCode,
          season: startSeason + s,
          kickoffUtc: new Date(t).toISOString(),
          homeTeamId: home,
          awayTeamId: away,
          homeGoals: samplePoisson(muH * alpha[home] * delta[away], rng),
          awayGoals: samplePoisson(muA * alpha[away] * delta[home], rng),
          status: 'FINISHED',
        });
      }
    }
  }
  return { ids, alpha, delta, matches, lastKickoff: new Date(t).toISOString() };
}

module.exports = { mulberry32, samplePoisson, syntheticLeague };
