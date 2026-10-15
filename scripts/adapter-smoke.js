'use strict';

/**
 * Phase 2 live smoke test (manual GitHub Actions workflow `adapter-smoke`).
 * Runs the real adapters against the providers and reports discovery, normalization,
 * cross-source team mapping and odds↔fixture linking. Writes nothing to any database.
 *
 * Cost: ≤ 15 football-data.org requests; ≤ 14 Odds API credits (2 per competition);
 * 5 football-data.co.uk CSV downloads. Output contains no secrets.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createFootballDataOrgAdapter } = require('../src/providers/footballDataOrg');
const { createOddsApiAdapter } = require('../src/providers/oddsApi');
const { createCreditBudget } = require('../src/providers/oddsApi/creditBudget');
const { createFootballDataCoUkAdapter } = require('../src/providers/footballDataCoUk');
const { createTeamMatcher, linkEventsToFixtures } = require('../src/domain/teams/matching');
const { COMPETITIONS } = require('../src/domain/competitions');

const OUT_DIR = process.env.SMOKE_OUT_DIR || 'smoke-output';

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const fdKey = process.env.FOOTBALL_DATA_ORG_KEY;
  const oddsKey = process.env.ODDS_API_KEY;
  if (!fdKey || !oddsKey) {
    console.error('FOOTBALL_DATA_ORG_KEY and ODDS_API_KEY must be set (GitHub Actions secrets).');
    process.exit(2);
  }
  const now = new Date();
  const fd = createFootballDataOrgAdapter({ apiKey: fdKey, baseUrl: process.env.SMOKE_FDORG_BASE, limiter: process.env.SMOKE_NO_DELAY ? async () => {} : undefined });
  const odds = createOddsApiAdapter({ apiKey: oddsKey, budget: createCreditBudget({ monthlyLimit: 500, reserve: 50 }), baseUrl: process.env.SMOKE_ODDS_BASE });
  const uk = createFootballDataCoUkAdapter({ baseUrl: process.env.SMOKE_FDCOUK_BASE }); // *_BASE: test overrides only
  const out = { generatedAtUtc: now.toISOString(), competitions: [] };

  const fdComps = new Map((await fd.listCompetitions()).map((c) => [c.competitionCode, c]));
  const oddsComps = new Map((await odds.listCompetitions()).map((c) => [c.competitionCode, c]));
  const from = isoDate(now);
  const to = isoDate(new Date(now.getTime() + 7 * 86400000));

  for (const comp of COMPETITIONS) {
    const entry = { code: comp.code, fdorg: fdComps.get(comp.code) || null, odds: oddsComps.get(comp.code) || null };
    out.competitions.push(entry);
    try {
      let matcher = null;
      let fixtures = [];
      if (entry.fdorg) {
        const teams = await fd.listTeams({ competitionCode: comp.code });
        entry.teams = teams.length;
        matcher = createTeamMatcher(teams.map((t) => ({ id: t.providerTeamId, names: [t.name, t.shortName] })));
        const fx = await fd.listFixtures({ competitionCode: comp.code, from, to });
        fixtures = fx.fixtures;
        entry.fixtures7d = { count: fixtures.length, report: fx.report };
      }
      if (entry.odds) {
        const o = await odds.getFeaturedOdds({ competitionCode: comp.code, purpose: 'other' });
        const byMarket = {};
        for (const q of o.quotes) byMarket[`${q.marketCode}${q.line ?? ''}`] = (byMarket[`${q.marketCode}${q.line ?? ''}`] || 0) + 1;
        entry.odds.result = { events: o.events.length, quotes: o.quotes.length, byMarket, report: o.report, credits: o.credits };
        if (matcher) {
          const names = [...new Set(o.events.flatMap((e) => [e.homeTeamName, e.awayTeamName]))];
          entry.oddsMapping = mappingReport(names, matcher);
          const upcoming = o.events.filter((e) => Date.parse(e.kickoffUtc) <= Date.parse(`${to}T23:59:59Z`));
          const l = linkEventsToFixtures({ events: upcoming, fixtures, matcher });
          entry.linking = { eventsInWindow: upcoming.length, linked: l.links.length, unlinked: l.unlinked.map((u) => `${u.event.homeTeamName} v ${u.event.awayTeamName} (${u.reason})`) };
        }
      }
      if (uk.supports(comp.code) && matcher) {
        const season = entry.fdorg && entry.fdorg.currentSeason ? entry.fdorg.currentSeason : now.getUTCFullYear();
        const s = await uk.getSeason({ competitionCode: comp.code, season });
        const names = [...new Set(s.fixtures.flatMap((f) => [f.home.name, f.away.name]))];
        entry.csv = { season, fixtures: s.fixtures.length, closingQuotes: s.closingQuotes.length, report: s.report };
        entry.csvMapping = mappingReport(names, matcher);
      }
    } catch (err) {
      entry.error = `${err.code || 'ERROR'}: ${err.message}`;
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'smoke.json'), JSON.stringify(out, null, 2));
  const md = toMarkdown(out);
  fs.writeFileSync(path.join(OUT_DIR, 'smoke.md'), md);
  console.log(md);
}

function mappingReport(names, matcher) {
  const unmatched = [];
  const ambiguous = [];
  const methods = {};
  for (const n of names) {
    const r = matcher.match(n);
    if (r.teamId) methods[r.method] = (methods[r.method] || 0) + 1;
    else if (r.reason === 'AMBIGUOUS') ambiguous.push(n);
    else unmatched.push(n);
  }
  return { names: names.length, matched: names.length - unmatched.length - ambiguous.length, methods, unmatched, ambiguous };
}

function toMarkdown(out) {
  const L = ['# Phase 2 adapter smoke test', '', `Generated (UTC): ${out.generatedAtUtc}`, ''];
  L.push('| Comp | fd.org | Teams | Fixtures 7d | Odds key | Events | Quotes by market | Credits | Odds names mapped | Linked | CSV fixtures | CSV names mapped | Error |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of out.competitions) {
    const o = c.odds && c.odds.result;
    L.push(`| ${c.code} | ${c.fdorg ? c.fdorg.providerCompetitionId : '—'} | ${c.teams ?? '—'} | ${c.fixtures7d ? c.fixtures7d.count : '—'} | ${c.odds ? c.odds.providerCompetitionId : '—'} | ${o ? o.events : '—'} | ${o ? Object.entries(o.byMarket).map(([k, v]) => `${k}:${v}`).join(' ') : '—'} | ${o ? o.credits.last : '—'} | ${c.oddsMapping ? `${c.oddsMapping.matched}/${c.oddsMapping.names}` : '—'} | ${c.linking ? `${c.linking.linked}/${c.linking.eventsInWindow}` : '—'} | ${c.csv ? c.csv.fixtures : '—'} | ${c.csvMapping ? `${c.csvMapping.matched}/${c.csvMapping.names}` : '—'} | ${c.error || ''} |`);
  }
  L.push('', '## Unmatched / ambiguous team names', '');
  for (const c of out.competitions) {
    for (const [label, m] of [['odds', c.oddsMapping], ['csv', c.csvMapping]]) {
      if (m && (m.unmatched.length || m.ambiguous.length)) {
        L.push(`- **${c.code} ${label}** unmatched: ${m.unmatched.join(', ') || '—'}; ambiguous: ${m.ambiguous.join(', ') || '—'}`);
      }
    }
    if (c.linking && c.linking.unlinked.length) L.push(`- **${c.code} unlinked events:** ${c.linking.unlinked.join('; ')}`);
  }
  const last = out.competitions.map((c) => c.odds && c.odds.result && c.odds.result.credits.remaining).filter((x) => x !== null && x !== undefined);
  L.push('', `Odds API credits remaining after run: ${last.length ? last[last.length - 1] : 'unknown'}`, '');
  return L.join('\n');
}

main().catch((err) => {
  console.error(`Smoke test aborted: ${err.code || ''} ${err.message}`);
  process.exit(1);
});
