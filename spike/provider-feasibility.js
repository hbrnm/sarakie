'use strict';

/**
 * FVIS Phase 2a — API-Football free-plan feasibility probe.
 *
 * Measurement only. Not production code: nothing here may be imported by src/.
 * Read-only GET requests, hard request cap, no secrets or raw payloads in output.
 *
 * Env:
 *   API_FOOTBALL_KEY   required (GitHub Actions secret)
 *   SPIKE_MAX_REQUESTS optional, default 35
 *   SPIKE_DELAY_MS     optional, default 7000 (stays under ~10 req/min)
 *   SPIKE_BASE_URL     optional, test override only
 *   SPIKE_OUT_DIR      optional, default ./spike-output
 */

const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = process.env.SPIKE_BASE_URL || 'https://v3.football.api-sports.io';
const KEY = process.env.API_FOOTBALL_KEY;
const MAX_REQUESTS = Number(process.env.SPIKE_MAX_REQUESTS || 35);
const DELAY_MS = Number(process.env.SPIKE_DELAY_MS || 7000);
const OUT_DIR = process.env.SPIKE_OUT_DIR || 'spike-output';
const QUOTA_RESERVE = 10;

// Discovered by name + country, never by hard-coded ID (CLAUDE.md §3).
const TARGET_LEAGUES = [
  { code: 'EPL', country: 'England', name: 'Premier League' },
  { code: 'LALIGA', country: 'Spain', name: 'La Liga' },
  { code: 'SERIEA', country: 'Italy', name: 'Serie A' },
  { code: 'BUNDESLIGA', country: 'Germany', name: 'Bundesliga' },
  { code: 'LIGUE1', country: 'France', name: 'Ligue 1' },
];

// Canonical FVIS markets → patterns for provider bet names (matched, not assumed).
const MARKET_PATTERNS = {
  '1X2': /^match winner$/i,
  DC: /^double chance$/i,
  DNB: /^(home\/away|draw no bet)$/i,
  OU: /^goals over\/under$/i,
  BTTS: /^both teams (to )?score$/i,
};
const OU_LINES = ['1.5', '2.5', '3.5'];

let requestCount = 0;
const requestLog = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(text) {
  return KEY ? String(text).split(KEY).join('[REDACTED]') : String(text);
}

async function get(endpoint, params = {}) {
  if (requestCount >= MAX_REQUESTS) {
    throw new Error(`request cap reached (${MAX_REQUESTS})`);
  }
  if (requestCount > 0) await sleep(DELAY_MS);
  requestCount += 1;

  const url = new URL(endpoint, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const started = Date.now();
  let res;
  try {
    res = await fetch(url, { headers: { 'x-apisports-key': KEY } });
  } catch (err) {
    requestLog.push({ endpoint, params, error: redact(err.message) });
    throw new Error(`network error on ${endpoint}: ${redact(err.message)}`, { cause: err });
  }
  const body = await res.json().catch(() => null);
  const errors = body && body.errors && Object.keys(body.errors).length ? body.errors : null;
  const entry = {
    endpoint,
    params,
    httpStatus: res.status,
    durationMs: Date.now() - started,
    results: body ? body.results : null,
    paging: body ? body.paging : null,
    errors,
    dailyRemaining: res.headers.get('x-ratelimit-requests-remaining'),
    minuteRemaining: res.headers.get('x-ratelimit-remaining'),
  };
  requestLog.push(entry);

  if (entry.dailyRemaining !== null && Number(entry.dailyRemaining) < QUOTA_RESERVE) {
    throw new Error(`daily quota reserve reached (remaining ${entry.dailyRemaining})`);
  }
  return { status: res.status, body, errors };
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function summarizeOdds(bookmakers) {
  const markets = {};
  const unmatchedBetNames = new Set();
  for (const bm of bookmakers || []) {
    for (const bet of bm.bets || []) {
      const code = Object.keys(MARKET_PATTERNS).find((c) => MARKET_PATTERNS[c].test(bet.name));
      if (!code) {
        unmatchedBetNames.add(bet.name);
        continue;
      }
      const m = (markets[code] ||= { providerBetNames: new Set(), bookmakers: new Set(), lines: {} });
      m.providerBetNames.add(`${bet.id}:${bet.name}`);
      m.bookmakers.add(bm.name);
      if (code === 'OU') {
        for (const v of bet.values || []) {
          const line = String(v.value).replace(/^(Over|Under)\s*/i, '');
          if (OU_LINES.includes(line)) (m.lines[line] ||= new Set()).add(bm.name);
        }
      }
    }
  }
  const out = {};
  for (const [code, m] of Object.entries(markets)) {
    out[code] = {
      providerBetNames: [...m.providerBetNames],
      bookmakerCount: m.bookmakers.size,
      ...(code === 'OU'
        ? { lineBookmakerCounts: Object.fromEntries(OU_LINES.map((l) => [l, m.lines[l] ? m.lines[l].size : 0])) }
        : {}),
    };
  }
  for (const code of Object.keys(MARKET_PATTERNS)) if (!out[code]) out[code] = { bookmakerCount: 0 };
  return { markets: out, otherBetNamesSample: [...unmatchedBetNames].slice(0, 15) };
}

async function main() {
  if (!KEY) {
    console.error('API_FOOTBALL_KEY is not set. Add it as a GitHub Actions secret.');
    process.exit(2);
  }

  const now = new Date();
  const report = { generatedAtUtc: now.toISOString(), baseUrl: BASE_URL, account: null, leagues: [], findings: {} };

  // 1. Account / plan / quota
  const status = await get('/status');
  const sr = status.body && status.body.response;
  report.account = sr && !Array.isArray(sr)
    ? {
        plan: sr.subscription && sr.subscription.plan,
        active: sr.subscription && sr.subscription.active,
        requestsToday: sr.requests && sr.requests.current,
        dailyLimit: sr.requests && sr.requests.limit_day,
      }
    : { errors: status.errors };

  // 2. League discovery + seasons/coverage
  for (const target of TARGET_LEAGUES) {
    const r = await get('/leagues', { country: target.country, name: target.name, type: 'league' });
    const match = (r.body && r.body.response || []).find(
      (x) => x.league && x.league.name === target.name && x.country && x.country.name === target.country,
    );
    if (!match) {
      report.leagues.push({ code: target.code, discovered: false, errors: r.errors });
      continue;
    }
    const seasons = (match.seasons || []).map((s) => ({
      year: s.year,
      current: s.current,
      start: s.start,
      end: s.end,
      coverageOdds: s.coverage ? s.coverage.odds : null,
      coverageFixtures: s.coverage && s.coverage.fixtures ? true : null,
    }));
    const current = seasons.find((s) => s.current) || null;
    report.leagues.push({
      code: target.code,
      discovered: true,
      providerLeagueId: match.league.id,
      currentSeason: current ? current.year : null,
      recentSeasons: seasons.sort((a, b) => b.year - a.year).slice(0, 5),
    });
  }

  // 3. Season access probe (first discovered league, current + 3 previous seasons)
  const probe = report.leagues.find((l) => l.discovered && l.currentSeason);
  report.findings.seasonAccess = [];
  if (probe) {
    for (let y = probe.currentSeason; y > probe.currentSeason - 4; y -= 1) {
      const r = await get('/fixtures', { league: probe.providerLeagueId, season: y });
      report.findings.seasonAccess.push({
        league: probe.code,
        season: y,
        httpStatus: r.status,
        fixturesReturned: r.body ? r.body.results : null,
        errors: r.errors,
      });
    }
  }

  // 4. Upcoming fixtures (next 7 days) + odds per league
  const from = isoDate(now);
  const to = isoDate(new Date(now.getTime() + 7 * 86400000));
  for (const league of report.leagues.filter((l) => l.discovered && l.currentSeason)) {
    const fx = await get('/fixtures', { league: league.providerLeagueId, season: league.currentSeason, from, to });
    const fixtures = (fx.body && fx.body.response) || [];
    league.upcoming = { window: `${from}..${to}`, count: fixtures.length, errors: fx.errors };
    const first = fixtures.find((f) => f.fixture && f.fixture.status && f.fixture.status.short === 'NS');
    if (!first) continue;

    const od = await get('/odds', { fixture: first.fixture.id });
    const item = od.body && od.body.response && od.body.response[0];
    league.oddsSample = {
      fixtureKickoffUtc: first.fixture.date,
      hoursToKickoff: Math.round((new Date(first.fixture.date) - now) / 36e5),
      errors: od.errors,
      providerUpdateTimestamp: item ? item.update : null,
      bookmakerTotal: item ? (item.bookmakers || []).length : 0,
      ...(item ? summarizeOdds(item.bookmakers) : {}),
    };

    // Cost of league-level odds retrieval for that date (pagination).
    const day = first.fixture.date.slice(0, 10);
    const lo = await get('/odds', { league: league.providerLeagueId, season: league.currentSeason, date: day });
    league.leagueOddsPaging = { date: day, paging: lo.body ? lo.body.paging : null, results: lo.body ? lo.body.results : null, errors: lo.errors };
  }

  // 5. Final quota reading
  const end = await get('/status');
  const er = end.body && end.body.response;
  report.account.requestsAfterRun = er && er.requests ? er.requests.current : null;
  report.requestsMadeByProbe = requestCount;
  report.requestLog = requestLog;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'summary.md'), toMarkdown(report));
  console.log(toMarkdown(report));
}

function toMarkdown(r) {
  const lines = [];
  lines.push('# API-Football feasibility probe', '');
  lines.push(`Generated (UTC): ${r.generatedAtUtc}`, '');
  lines.push('## Account', '', '```json', JSON.stringify(r.account, null, 2), '```', '');
  lines.push('## Leagues', '', '| League | ID | Current season | Coverage odds (current) | Upcoming 7d | Odds bookmakers | Odds update |', '|---|---|---|---|---|---|---|');
  for (const l of r.leagues) {
    const cur = (l.recentSeasons || []).find((s) => s.current);
    lines.push(`| ${l.code} | ${l.providerLeagueId ?? '—'} | ${l.currentSeason ?? '—'} | ${cur ? cur.coverageOdds : '—'} | ${l.upcoming ? l.upcoming.count : '—'} | ${l.oddsSample ? l.oddsSample.bookmakerTotal : '—'} | ${l.oddsSample ? l.oddsSample.providerUpdateTimestamp : '—'} |`);
  }
  lines.push('', '## Season access (probe league)', '', '| Season | HTTP | Fixtures | Errors |', '|---|---|---|---|');
  for (const s of r.findings.seasonAccess || []) {
    lines.push(`| ${s.season} | ${s.httpStatus} | ${s.fixturesReturned} | ${s.errors ? JSON.stringify(s.errors) : ''} |`);
  }
  lines.push('', '## Market coverage (bookmakers per market, one fixture per league)', '', '| League | 1X2 | DC | DNB | OU (1.5/2.5/3.5) | BTTS | Errors |', '|---|---|---|---|---|---|---|');
  for (const l of r.leagues) {
    const m = l.oddsSample && l.oddsSample.markets;
    if (!m) {
      lines.push(`| ${l.code} | — | — | — | — | — | ${l.oddsSample && l.oddsSample.errors ? JSON.stringify(l.oddsSample.errors) : (l.upcoming && l.upcoming.errors ? JSON.stringify(l.upcoming.errors) : 'no sample')} |`);
      continue;
    }
    const ou = m.OU.lineBookmakerCounts ? OU_LINES.map((x) => m.OU.lineBookmakerCounts[x]).join('/') : '0/0/0';
    lines.push(`| ${l.code} | ${m['1X2'].bookmakerCount} | ${m.DC.bookmakerCount} | ${m.DNB.bookmakerCount} | ${ou} | ${m.BTTS.bookmakerCount} | ${l.oddsSample.errors ? JSON.stringify(l.oddsSample.errors) : ''} |`);
  }
  lines.push('', `Requests made by probe: ${r.requestsMadeByProbe}`, '');
  return lines.join('\n');
}

main().catch((err) => {
  console.error(`Probe aborted: ${redact(err.message)}`);
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'request-log.json'), JSON.stringify({ requestCount, requestLog }, null, 2));
  } catch (_) {
    // ignore secondary failure
  }
  process.exit(1);
});
