'use strict';

const { unwrap } = require('./supabase');

/**
 * Read-only queries used by the Telegram bot.
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 */
function createQueries(db, { creditStore, now = () => new Date() } = {}) {
  /**
   * Upcoming matches from fixtures, plus odds-only events for competitions without fixtures
   * coverage (e.g. UEL). Sorted by kickoff.
   */
  async function upcoming({ from, to, competitionCodes }) {
    let fq = db
      .from('fixtures')
      .select('competition_code, kickoff_utc, status, home_team_id, away_team_id')
      .gte('kickoff_utc', from.toISOString())
      .lt('kickoff_utc', to.toISOString())
      .in('status', ['SCHEDULED', 'LIVE'])
      .in('competition_code', competitionCodes)
      .order('kickoff_utc', { ascending: true });
    const fixtures = unwrap(await fq, 'read upcoming fixtures');
    const teamIds = [...new Set(fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]))];
    const teams = teamIds.length ? unwrap(await db.from('teams').select('id, name, short_name').in('id', teamIds), 'read teams') : [];
    const nameOf = new Map(teams.map((t) => [t.id, t.short_name || t.name]));
    const items = fixtures.map((f) => ({
      competitionCode: f.competition_code,
      kickoffUtc: f.kickoff_utc,
      home: nameOf.get(f.home_team_id) || '?',
      away: nameOf.get(f.away_team_id) || '?',
      source: 'fixtures',
    }));

    const withFixtures = new Set(items.map((i) => i.competitionCode));
    const oddsOnly = competitionCodes.filter((c) => !withFixtures.has(c));
    if (oddsOnly.length) {
      const events = unwrap(
        await db
          .from('odds_events')
          .select('competition_code, kickoff_utc, home_team_name, away_team_name')
          .gte('kickoff_utc', from.toISOString())
          .lt('kickoff_utc', to.toISOString())
          .in('competition_code', oddsOnly)
          .order('kickoff_utc', { ascending: true }),
        'read upcoming odds events',
      );
      for (const e of events) {
        items.push({ competitionCode: e.competition_code, kickoffUtc: e.kickoff_utc, home: e.home_team_name, away: e.away_team_name, source: 'odds_events' });
      }
    }
    return items.sort((a, b) => Date.parse(a.kickoffUtc) - Date.parse(b.kickoffUtc));
  }

  async function quota({ budget }) {
    const usage = await budget.usage();
    const dayStart = new Date(now());
    dayStart.setUTCHours(0, 0, 0, 0);
    const rows = unwrap(
      await db.from('provider_request_log').select('source_provider').gte('requested_at', dayStart.toISOString()),
      'read request log',
    );
    const today = {};
    for (const r of rows) today[r.source_provider] = (today[r.source_provider] || 0) + 1;
    return { odds: usage, requestsToday: today };
  }

  return { upcoming, quota, creditStore };
}

module.exports = { createQueries };
