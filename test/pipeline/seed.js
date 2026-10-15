'use strict';

const { createFakeDb } = require('../persistence/fakeDb');
const { createAnalysisStore } = require('../../src/persistence/analysisStore');
const { L, FIXTURE, book } = require('../risk/helpers');

const FIXTURE_ID = 'fx-target';

// Over 2.5 priced above model-fair at three books (same scenario as test/risk) → QUALIFIED.
const BOOST = { market: 'OU', sel: 'OVER', line: 2.5, factor: 1.18 };
const BOOKS = () => ['b1', 'b2', 'b3'].flatMap((k) => book(k, { margin: 0.1, boost: BOOST }));

/** Fake database with the synthetic league as history, the target fixture and odds. */
function seed({ linkOnly = false, quotes = BOOKS() } = {}) {
  const fake = createFakeDb();
  for (const id of L.ids) fake.table('teams').push({ id, name: `Team ${id}`, short_name: id === 'T01' ? 'Home FC' : null });
  L.matches.forEach((m, i) =>
    fake.table('fixtures').push({
      id: `h${i}`, competition_code: m.competitionCode, season: m.season, kickoff_utc: m.kickoffUtc, status: 'FINISHED',
      home_team_id: m.homeTeamId, away_team_id: m.awayTeamId, home_goals: m.homeGoals, away_goals: m.awayGoals,
    }),
  );
  fake.table('fixtures').push({
    id: FIXTURE_ID, competition_code: 'EPL', season: FIXTURE.season, kickoff_utc: FIXTURE.kickoffUtc, status: 'SCHEDULED',
    home_team_id: FIXTURE.homeTeamId, away_team_id: FIXTURE.awayTeamId, home_goals: null, away_goals: null,
  });
  const keys = [...new Set(quotes.map((q) => q.bookmakerKey))];
  keys.forEach((k, i) => fake.table('bookmakers').push({ id: i + 1, source_provider: 'the_odds_api', provider_bookmaker_key: k, name: k.toUpperCase() }));
  quotes.forEach((q, i) =>
    fake.table('odds_snapshots').push({
      id: i + 1, fixture_id: linkOnly ? null : FIXTURE_ID, source_provider: 'the_odds_api', provider_event_id: 'ev1',
      bookmaker_id: keys.indexOf(q.bookmakerKey) + 1, market_code: q.marketCode, selection_code: q.selectionCode, line: q.line,
      decimal_odds: q.decimalOdds, kind: 'pre_match', source_timestamp: null, captured_at: q.capturedAt,
    }),
  );
  if (linkOnly) fake.table('odds_event_links').push({ source_provider: 'the_odds_api', provider_event_id: 'ev1', fixture_id: FIXTURE_ID });
  return { fake, store: createAnalysisStore(fake) };
}

module.exports = { FIXTURE_ID, BOOST, BOOKS, seed };
