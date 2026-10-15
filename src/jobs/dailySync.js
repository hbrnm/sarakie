'use strict';

const { COMPETITIONS } = require('../domain/competitions');
const { createTeamMatcher, linkEventsToFixtures } = require('../domain/teams/matching');

const PRIMARY = 'football_data_org';
const ODDS = 'the_odds_api';
const DAY = 86400000;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Daily data sync (D-11):
 * 1. fixtures and recent results for every competition football-data.org covers
 *    (window: 3 days back for late scores, 7 days ahead for /fixtures);
 * 2. featured odds (1X2 + main O/U, ~2 credits per competition) only for competitions
 *    with a match in the next `oddsHorizonHours`, gated by the monthly credit budget;
 * 3. competitions without fixtures coverage (UEL) use the odds events list instead.
 * No model, no predictions (Phase 3+).
 *
 * @param {{ fd: object, odds: object, repo: object, now?: () => Date, oddsHorizonHours?: number }} deps
 */
async function dailySync({ fd, odds, repo, now = () => new Date(), oddsHorizonHours = 48 }) {
  const t0 = now();
  const horizonEnd = t0.getTime() + oddsHorizonHours * 3600000;
  const fdComps = await fd.listCompetitions();
  const oddsComps = await odds.listCompetitions();
  await repo.upsertProviderCompetitions([...fdComps, ...oddsComps]);
  const fdBy = new Map(fdComps.map((c) => [c.competitionCode, c]));
  const oddsBy = new Map(oddsComps.map((c) => [c.competitionCode, c]));
  const report = [];

  for (const comp of COMPETITIONS) {
    const entry = { code: comp.code };
    report.push(entry);
    try {
      let fixtures = [];
      let saved = new Map();
      let teamIds = new Map();
      if (fdBy.has(comp.code)) {
        const r = await fd.listFixtures({ competitionCode: comp.code, from: isoDate(new Date(t0.getTime() - 3 * DAY)), to: isoDate(new Date(t0.getTime() + 7 * DAY)) });
        fixtures = r.fixtures;
        const teamRefs = fixtures.flatMap((f) => [f.home, f.away]);
        teamIds = await repo.ensurePrimaryTeams(PRIMARY, teamRefs);
        await repo.updateTeamNames(teamRefs.map((t) => ({ id: teamIds.get(t.providerTeamId), name: t.name, shortName: t.shortName })));
        const up = await repo.upsertFixtures(fixtures, teamIds);
        saved = up.saved;
        entry.fixtures = { received: r.report.received, saved: saved.size, skipped: up.skipped, dropped: r.report.dropped };
      } else {
        entry.fixtures = 'NO_PROVIDER_COVERAGE';
      }

      if (!oddsBy.has(comp.code)) {
        entry.odds = 'NO_PROVIDER_COVERAGE';
        continue;
      }
      let soon;
      if (fdBy.has(comp.code)) {
        soon = fixtures.some((f) => f.status === 'SCHEDULED' && Date.parse(f.kickoffUtc) >= t0.getTime() && Date.parse(f.kickoffUtc) <= horizonEnd);
      } else {
        const ev = await odds.listEvents({ competitionCode: comp.code });
        await repo.upsertOddsEvents(ODDS, ev.events);
        entry.eventsListCredits = ev.credits.last;
        soon = ev.events.some((e) => Date.parse(e.kickoffUtc) >= t0.getTime() && Date.parse(e.kickoffUtc) <= horizonEnd);
      }
      if (!soon) {
        entry.odds = 'NO_MATCH_IN_HORIZON';
        continue;
      }

      let r;
      try {
        r = await odds.getFeaturedOdds({ competitionCode: comp.code, purpose: 'scanner' });
      } catch (err) {
        if (err.code === 'CREDIT_BUDGET') {
          entry.odds = `SKIPPED_${err.reason}`;
          continue;
        }
        throw err;
      }
      await repo.upsertOddsEvents(ODDS, r.events);
      const fixtureIdByEvent = new Map();
      if (fixtures.length) {
        const teams = [...new Map(fixtures.flatMap((f) => [f.home, f.away]).map((t) => [t.providerTeamId, t])).values()];
        const matcher = createTeamMatcher(teams.map((t) => ({ id: t.providerTeamId, names: [t.name, t.shortName] })));
        const { links } = linkEventsToFixtures({ events: r.events, fixtures, matcher });
        for (const l of links) if (saved.has(l.providerFixtureId)) fixtureIdByEvent.set(l.providerEventId, saved.get(l.providerFixtureId));
        await repo.linkOddsEvents(ODDS, [...fixtureIdByEvent].map(([providerEventId, fixtureId]) => ({ providerEventId, fixtureId })));
        const mapped = [];
        for (const name of new Set(r.events.flatMap((e) => [e.homeTeamName, e.awayTeamName]))) {
          const m = matcher.match(name);
          if (m.teamId && teamIds.get(m.teamId)) mapped.push({ providerName: name, teamId: teamIds.get(m.teamId), method: m.method });
        }
        await repo.upsertSecondaryTeamMap(ODDS, mapped);
      }
      const ins = await repo.insertOddsSnapshots(r.quotes, { fixtureIdByEvent });
      entry.odds = { events: r.events.length, linked: fixtureIdByEvent.size, quotes: ins.inserted, credits: r.credits.last, remaining: r.credits.remaining };
    } catch (err) {
      entry.error = `${err.code || 'ERROR'}: ${err.message}`;
    }
  }
  return report;
}

module.exports = { dailySync };
