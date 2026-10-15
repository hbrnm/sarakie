'use strict';

/**
 * FVIS Phase 2b — feasibility probe for the free-source combination (D-02, option 1):
 *   A. football-data.org   — current-season fixtures and results
 *   B. The Odds API         — pre-match odds and market coverage
 *   C. football-data.co.uk  — historical results + closing odds (public CSV, no key)
 *
 * Measurement only. Not production code: nothing here may be imported by src/.
 * Read-only GET requests, per-source request caps, no secrets or raw payloads in output.
 * A source whose key is missing is skipped, not failed.
 *
 * Env:
 *   FOOTBALL_DATA_ORG_KEY  optional (GitHub Actions secret)
 *   ODDS_API_KEY           optional (GitHub Actions secret)
 *   SPIKE_OUT_DIR          optional, default ./spike-output
 *   SPIKE_FDORG_BASE, SPIKE_ODDS_BASE, SPIKE_FDCOUK_BASE, SPIKE_DELAY_MS — test overrides only
 */

const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = process.env.SPIKE_OUT_DIR || 'spike-output';
const DELAY_MS = process.env.SPIKE_DELAY_MS !== undefined ? Number(process.env.SPIKE_DELAY_MS) : null;
const SECRETS = [process.env.FOOTBALL_DATA_ORG_KEY, process.env.ODDS_API_KEY].filter(Boolean);

const LEAGUES = [
  { code: 'EPL', country: 'England', fdorgName: /^premier league$/i, oddsTitle: /^(epl|premier league)$/i, fdcoukDiv: 'E0' },
  { code: 'LALIGA', country: 'Spain', fdorgName: /^(primera division|la ?liga)$/i, oddsTitle: /^la ?liga\b/i, fdcoukDiv: 'SP1' },
  { code: 'SERIEA', country: 'Italy', fdorgName: /^serie a$/i, oddsTitle: /^serie a\b/i, fdcoukDiv: 'I1' },
  { code: 'BUNDESLIGA', country: 'Germany', fdorgName: /^bundesliga$/i, oddsTitle: /^bundesliga\b(?!.*2)/i, fdcoukDiv: 'D1' },
  { code: 'LIGUE1', country: 'France', fdorgName: /^ligue 1$/i, oddsTitle: /^ligue 1\b/i, fdcoukDiv: 'F1' },
];

function redact(text) {
  let s = String(text);
  for (const k of SECRETS) s = s.split(k).join('[REDACTED]');
  return s;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Small rate-limited, capped client per source. */
function makeClient({ name, base, maxRequests, delayMs, headers = {}, query = {}, quotaHeaders = [] }) {
  const log = [];
  let count = 0;
  async function get(pathname, params = {}, { raw = false } = {}) {
    if (count >= maxRequests) throw new Error(`${name}: request cap reached (${maxRequests})`);
    if (count > 0) await sleep(DELAY_MS ?? delayMs);
    count += 1;
    const url = new URL(pathname.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`);
    for (const [k, v] of Object.entries({ ...query, ...params })) url.searchParams.set(k, String(v));
    const started = Date.now();
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (err) {
      log.push({ path: pathname, params, error: redact(err.message) });
      return { status: 0, body: null, error: redact(err.message) };
    }
    const text = await res.text();
    let body = text;
    if (!raw) {
      try {
        body = JSON.parse(text);
      } catch (_) {
        body = null;
      }
    }
    const quota = Object.fromEntries(quotaHeaders.map((h) => [h, res.headers.get(h)]));
    log.push({ path: pathname, params, httpStatus: res.status, durationMs: Date.now() - started, quota });
    return { status: res.status, body, headers: res.headers, quota };
  }
  return { get, log, count: () => count };
}

// ---------------------------------------------------------------- A. football-data.org

async function probeFootballDataOrg(now) {
  const key = process.env.FOOTBALL_DATA_ORG_KEY;
  if (!key) return { skipped: 'FOOTBALL_DATA_ORG_KEY not set' };
  const c = makeClient({
    name: 'football-data.org',
    base: process.env.SPIKE_FDORG_BASE || 'https://api.football-data.org/v4',
    maxRequests: 14,
    delayMs: 7000, // free tier reported at 10 req/min
    headers: { 'X-Auth-Token': key },
    quotaHeaders: ['x-requests-available-minute', 'x-requestcounter-reset'],
  });
  const out = { leagues: [] };

  const comps = await c.get('/competitions');
  const list = (comps.body && comps.body.competitions) || [];
  out.competitionsHttp = comps.status;
  out.competitionsAvailable = list.length;
  if (comps.status !== 200) out.competitionsError = comps.body && comps.body.message;

  const from = isoDate(now);
  const to = isoDate(new Date(now.getTime() + 7 * 86400000));
  for (const L of LEAGUES) {
    const comp = list.find((x) => L.fdorgName.test(x.name) && x.area && x.area.name === L.country);
    if (!comp) {
      out.leagues.push({ code: L.code, discovered: false });
      continue;
    }
    const entry = {
      code: L.code,
      discovered: true,
      providerId: comp.id,
      providerCode: comp.code,
      plan: comp.plan,
      currentSeasonStart: comp.currentSeason && comp.currentSeason.startDate,
      currentMatchday: comp.currentSeason && comp.currentSeason.currentMatchday,
    };
    const up = await c.get(`/competitions/${comp.id}/matches`, { dateFrom: from, dateTo: to });
    const upMatches = (up.body && up.body.matches) || [];
    entry.upcoming = {
      http: up.status,
      window: `${from}..${to}`,
      count: upMatches.length,
      sampleTeams: upMatches.slice(0, 3).map((m) => `${m.homeTeam && m.homeTeam.name} v ${m.awayTeam && m.awayTeam.name}`),
      error: up.status !== 200 ? up.body && up.body.message : undefined,
    };
    const fin = await c.get(`/competitions/${comp.id}/matches`, { status: 'FINISHED' });
    const finMatches = (fin.body && fin.body.matches) || [];
    const last = finMatches.map((m) => m.utcDate).sort().pop();
    entry.finishedCurrentSeason = {
      http: fin.status,
      count: finMatches.length,
      withFullTimeScore: finMatches.filter((m) => m.score && m.score.fullTime && m.score.fullTime.home !== null).length,
      lastFinishedUtc: last || null,
      lagHoursSinceLastFinished: last ? Math.round((now - new Date(last)) / 36e5) : null,
      error: fin.status !== 200 ? fin.body && fin.body.message : undefined,
    };
    out.leagues.push(entry);
  }

  // History depth: previous season for the first discovered league.
  const first = out.leagues.find((l) => l.discovered && l.currentSeasonStart);
  if (first) {
    const prev = Number(first.currentSeasonStart.slice(0, 4)) - 1;
    const r = await c.get(`/competitions/${first.providerId}/matches`, { season: prev });
    out.previousSeasonAccess = {
      league: first.code,
      season: prev,
      http: r.status,
      count: r.body && r.body.matches ? r.body.matches.length : 0,
      error: r.status !== 200 ? r.body && r.body.message : undefined,
    };
  }
  out.requests = c.count();
  out.requestLog = c.log;
  return out;
}

// ---------------------------------------------------------------- B. The Odds API

const ODDS_MARKET_MAP = { h2h: '1X2', totals: 'OU', btts: 'BTTS', draw_no_bet: 'DNB', double_chance: 'DC', alternate_totals: 'OU_ALT' };

function summarizeOddsEvent(ev) {
  const markets = {};
  for (const bm of ev.bookmakers || []) {
    for (const m of bm.markets || []) {
      const s = (markets[m.key] ||= { bookmakers: new Set(), points: new Set(), lastUpdates: [] });
      s.bookmakers.add(bm.key);
      if (m.last_update) s.lastUpdates.push(m.last_update);
      for (const o of m.outcomes || []) if (o.point !== undefined) s.points.add(o.point);
    }
  }
  const out = {};
  for (const [k, s] of Object.entries(markets)) {
    const sorted = s.lastUpdates.sort();
    out[k] = {
      fvisMarket: ODDS_MARKET_MAP[k] || null,
      bookmakerCount: s.bookmakers.size,
      lines: [...s.points].sort((a, b) => a - b).slice(0, 12),
      oldestUpdate: sorted[0] || null,
      newestUpdate: sorted[sorted.length - 1] || null,
    };
  }
  return out;
}

async function probeOddsApi(now) {
  const key = process.env.ODDS_API_KEY;
  if (!key) return { skipped: 'ODDS_API_KEY not set' };
  const c = makeClient({
    name: 'the-odds-api',
    base: process.env.SPIKE_ODDS_BASE || 'https://api.the-odds-api.com/v4',
    maxRequests: 10,
    delayMs: 1500,
    query: { apiKey: key },
    quotaHeaders: ['x-requests-remaining', 'x-requests-used', 'x-requests-last'],
  });
  const MIN_REMAINING = 50;
  const out = { leagues: [] };
  const remainingOk = (r) => {
    const rem = r.quota && r.quota['x-requests-remaining'];
    return rem === null || rem === undefined || Number(rem) >= MIN_REMAINING;
  };

  const sports = await c.get('/sports'); // reported as free of quota cost
  const list = Array.isArray(sports.body) ? sports.body : [];
  out.sportsHttp = sports.status;
  out.quotaAtStart = sports.quota;
  if (sports.status !== 200) out.sportsError = sports.body && sports.body.message;

  let sampleEvent = null;
  for (const L of LEAGUES) {
    const sp = list.find((s) => /soccer/i.test(s.group || s.key) && L.oddsTitle.test(s.title || ''));
    if (!sp) {
      out.leagues.push({ code: L.code, discovered: false });
      continue;
    }
    const entry = { code: L.code, discovered: true, sportKey: sp.key, title: sp.title, active: sp.active };
    if (!remainingOk(c.log[c.log.length - 1])) {
      entry.skipped = 'quota reserve reached';
      out.leagues.push(entry);
      continue;
    }
    // Featured markets: cost reported as markets × regions = 2 credits.
    const r = await c.get(`/sports/${sp.key}/odds`, { regions: 'eu', markets: 'h2h,totals', oddsFormat: 'decimal', dateFormat: 'iso' });
    const events = Array.isArray(r.body) ? r.body : [];
    const in7d = events.filter((e) => new Date(e.commence_time) - now <= 7 * 86400000);
    entry.featured = {
      http: r.status,
      creditsCharged: r.quota['x-requests-last'],
      eventsReturned: events.length,
      eventsNext7d: in7d.length,
      sampleTeams: events.slice(0, 3).map((e) => `${e.home_team} v ${e.away_team}`),
      markets: events[0] ? summarizeOddsEvent(events[0]) : {},
      error: r.status !== 200 ? r.body && r.body.message : undefined,
    };
    if (!sampleEvent && events[0]) sampleEvent = { sportKey: sp.key, id: events[0].id, league: L.code, commence: events[0].commence_time };
    out.leagues.push(entry);
  }

  // Additional markets for one event (DC, DNB, BTTS, O/U 1.5/3.5 via alternate totals).
  if (sampleEvent && remainingOk(c.log[c.log.length - 1])) {
    const mk = await c.get(`/sports/${sampleEvent.sportKey}/events/${sampleEvent.id}/markets`, { regions: 'eu' });
    const seen = new Set();
    for (const bm of (mk.body && mk.body.bookmakers) || []) for (const m of bm.markets || []) seen.add(m.key);
    out.eventMarketDiscovery = { league: sampleEvent.league, http: mk.status, creditsCharged: mk.quota['x-requests-last'], marketKeysSeen: [...seen].sort() };

    if (remainingOk(mk)) {
      const ex = await c.get(`/sports/${sampleEvent.sportKey}/events/${sampleEvent.id}/odds`, {
        regions: 'eu',
        markets: 'btts,draw_no_bet,double_chance,alternate_totals',
        oddsFormat: 'decimal',
        dateFormat: 'iso',
      });
      out.additionalMarkets = {
        league: sampleEvent.league,
        commence: sampleEvent.commence,
        http: ex.status,
        creditsCharged: ex.quota['x-requests-last'],
        markets: ex.body && ex.body.bookmakers ? summarizeOddsEvent(ex.body) : {},
        error: ex.status !== 200 ? ex.body && ex.body.message : undefined,
      };
    }
  }
  out.quotaAtEnd = c.log.length ? c.log[c.log.length - 1].quota : null;
  out.requests = c.count();
  out.requestLog = c.log;
  return out;
}

// ---------------------------------------------------------------- C. football-data.co.uk

const FDCOUK_COLUMNS = [
  'Date', 'Time', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG',
  'B365H', 'PSH', 'AvgH', 'MaxH', 'B365CH', 'PSCH', 'AvgCH', 'MaxCH',
  'B365>2.5', 'P>2.5', 'Avg>2.5', 'AvgC>2.5', 'PC>2.5',
];

function seasonCode(startYear) {
  return `${String(startYear % 100).padStart(2, '0')}${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function parseDdMmYyyy(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(s || '');
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[2]}-${m[1]}`;
}

async function probeFootballDataCoUk(now) {
  const c = makeClient({
    name: 'football-data.co.uk',
    base: process.env.SPIKE_FDCOUK_BASE || 'https://www.football-data.co.uk',
    maxRequests: 12,
    delayMs: 1500,
  });
  const cur = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const out = { seasons: [seasonCode(cur), seasonCode(cur - 1)], files: [] };
  for (const sc of out.seasons) {
    for (const L of LEAGUES) {
      const r = await c.get(`/mmz4281/${sc}/${L.fdcoukDiv}.csv`, {}, { raw: true });
      const entry = { code: L.code, season: sc, http: r.status };
      if (r.status === 200 && typeof r.body === 'string') {
        const lines = r.body.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() && l.replace(/,/g, '').trim());
        const header = (lines[0] || '').split(',');
        const rows = lines.slice(1).map((l) => l.split(','));
        const idx = (col) => header.indexOf(col);
        const dates = rows.map((row) => parseDdMmYyyy(row[idx('Date')])).filter(Boolean).sort();
        entry.rows = rows.length;
        entry.columnCount = header.length;
        entry.columnsPresent = FDCOUK_COLUMNS.filter((col) => idx(col) >= 0);
        entry.columnsMissing = FDCOUK_COLUMNS.filter((col) => idx(col) < 0);
        entry.bttsOrDcColumns = header.filter((h) => /btts|bts|dc/i.test(h));
        entry.ouLines = [...new Set(header.map((h) => (/[<>](\d\.\d)$/.exec(h) || [])[1]).filter(Boolean))];
        entry.firstMatchDate = dates[0] || null;
        entry.lastMatchDate = dates[dates.length - 1] || null;
        if (idx('HomeTeam') >= 0) entry.sampleTeams = rows.slice(0, 3).map((row) => `${row[idx('HomeTeam')]} v ${row[idx('AwayTeam')]}`);
      }
      out.files.push(entry);
    }
  }
  out.requests = c.count();
  return out;
}

// ---------------------------------------------------------------- report

function table(headers, rows) {
  return [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map((x) => (x === undefined || x === null || x === '' ? '—' : String(x).replace(/\|/g, '/'))).join(' | ')} |`)].join('\n');
}

function toMarkdown(r) {
  const md = ['# Free-sources feasibility probe (Phase 2b)', '', `Generated (UTC): ${r.generatedAtUtc}`, ''];

  md.push('## A. football-data.org', '');
  const a = r.footballDataOrg;
  if (a.skipped || a.error) md.push(`Skipped/failed: ${a.skipped || a.error}`, '');
  else {
    md.push(`Competitions visible: ${a.competitionsAvailable} (HTTP ${a.competitionsHttp}) ${a.competitionsError || ''}`, '');
    md.push(table(['League', 'ID/code', 'Season start', 'Upcoming 7d', 'Finished (cur. season)', 'Last finished (UTC)', 'Lag h', 'Errors'],
      a.leagues.map((l) => l.discovered
        ? [l.code, `${l.providerId}/${l.providerCode}`, l.currentSeasonStart, l.upcoming.count, `${l.finishedCurrentSeason.count} (${l.finishedCurrentSeason.withFullTimeScore} scored)`, l.finishedCurrentSeason.lastFinishedUtc, l.finishedCurrentSeason.lagHoursSinceLastFinished, [l.upcoming.error, l.finishedCurrentSeason.error].filter(Boolean).join('; ')]
        : [l.code, 'NOT FOUND'])), '');
    if (a.previousSeasonAccess) md.push(`Previous season access (${a.previousSeasonAccess.league} ${a.previousSeasonAccess.season}): HTTP ${a.previousSeasonAccess.http}, matches ${a.previousSeasonAccess.count} ${a.previousSeasonAccess.error || ''}`, '');
    const epl = a.leagues.find((l) => l.code === 'EPL' && l.upcoming);
    if (epl) md.push(`EPL team-name sample: ${epl.upcoming.sampleTeams.join('; ')}`, '');
    md.push(`Requests: ${a.requests}`, '');
  }

  md.push('## B. The Odds API', '');
  const b = r.oddsApi;
  if (b.skipped || b.error) md.push(`Skipped/failed: ${b.skipped || b.error}`, '');
  else {
    md.push(`Quota at start: ${JSON.stringify(b.quotaAtStart)} — at end: ${JSON.stringify(b.quotaAtEnd)}`, '');
    md.push(table(['League', 'Sport key', 'Events', 'Next 7d', 'Credits', 'h2h books', 'totals books', 'totals lines', 'newest update', 'Errors'],
      b.leagues.map((l) => {
        if (!l.discovered) return [l.code, 'NOT FOUND'];
        if (!l.featured) return [l.code, l.sportKey, l.skipped];
        const m = l.featured.markets;
        return [l.code, l.sportKey, l.featured.eventsReturned, l.featured.eventsNext7d, l.featured.creditsCharged, m.h2h && m.h2h.bookmakerCount, m.totals && m.totals.bookmakerCount, m.totals && m.totals.lines.join('/'), m.h2h && m.h2h.newestUpdate, l.featured.error];
      })), '');
    if (b.eventMarketDiscovery) md.push(`Market keys seen for one ${b.eventMarketDiscovery.league} event (credits ${b.eventMarketDiscovery.creditsCharged}): ${b.eventMarketDiscovery.marketKeysSeen.join(', ') || 'none'}`, '');
    if (b.additionalMarkets) {
      md.push(`Additional markets, one ${b.additionalMarkets.league} event (HTTP ${b.additionalMarkets.http}, credits ${b.additionalMarkets.creditsCharged}) ${b.additionalMarkets.error || ''}`, '');
      md.push(table(['Market key', 'FVIS market', 'Bookmakers', 'Lines'],
        Object.entries(b.additionalMarkets.markets).map(([k, m]) => [k, m.fvisMarket, m.bookmakerCount, m.lines.join('/')])), '');
    }
    const epl = b.leagues.find((l) => l.code === 'EPL' && l.featured);
    if (epl) md.push(`EPL team-name sample: ${epl.featured.sampleTeams.join('; ')}`, '');
    md.push(`Requests: ${b.requests}`, '');
  }

  md.push('## C. football-data.co.uk', '');
  const cc = r.footballDataCoUk;
  if (cc.error) md.push(`Failed: ${cc.error}`, '');
  else {
    md.push(table(['League', 'Season', 'HTTP', 'Rows', 'First', 'Last', 'Closing odds cols', 'O/U lines', 'BTTS/DC cols'],
      cc.files.map((f) => [f.code, f.season, f.http, f.rows, f.firstMatchDate, f.lastMatchDate, f.columnsPresent ? f.columnsPresent.filter((x) => /^(B365C|PSC|AvgC|MaxC|PC)/.test(x)).join(' ') : '', f.ouLines ? f.ouLines.join('/') : '', f.bttsOrDcColumns ? f.bttsOrDcColumns.join(' ') : ''])), '');
    const epl = cc.files.find((f) => f.code === 'EPL' && f.sampleTeams);
    if (epl) md.push(`EPL team-name sample (${epl.season}): ${epl.sampleTeams.join('; ')}`, '');
    md.push(`Requests: ${cc.requests}`, '');
  }
  return md.join('\n');
}

async function main() {
  const now = new Date();
  const report = { generatedAtUtc: now.toISOString() };
  const run = async (name, fn) => {
    try {
      report[name] = await fn(now);
    } catch (err) {
      report[name] = { error: redact(err.message) };
    }
  };
  // Sequential: different hosts, but keeps logs readable and load gentle.
  await run('footballDataOrg', probeFootballDataOrg);
  await run('oddsApi', probeOddsApi);
  await run('footballDataCoUk', probeFootballDataCoUk);

  const md = toMarkdown(report);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'report-2b.json'), redact(JSON.stringify(report, null, 2)));
  fs.writeFileSync(path.join(OUT_DIR, 'summary-2b.md'), redact(md));
  console.log(redact(md));
}

main().catch((err) => {
  console.error(`Probe aborted: ${redact(err.message)}`);
  process.exit(1);
});
