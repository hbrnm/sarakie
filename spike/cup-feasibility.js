'use strict';

/**
 * FVIS Phase 6a — feasibility probe for a cross-league (UCL/UEL) model extension (D-21).
 *
 * Measures, for the clubs currently in the UEFA Champions League and Europa League:
 *   A. which clubs are in play (The Odds API events list — 0 credits; stored odds events;
 *      football-data.org CL teams with their country);
 *   B. ClubElo (public CSV): availability, coverage of the cup clubs, history depth;
 *   C. football-data.co.uk (public CSV): which cup clubs have domestic results data
 *      (main divisions + extra leagues);
 *   D. historical UEFA results: football-data.org CL/EL seasons on the free tier and the
 *      openfootball/champions-league repository.
 *
 * Measurement only. Not production code: nothing in src/ may import this file.
 * Read-only GET requests, per-source request caps, secrets redacted, aggregates and public
 * club names only in the output. A source whose key is missing is skipped, not failed.
 *
 * Env: FOOTBALL_DATA_ORG_KEY, ODDS_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (all
 * optional), SPIKE_OUT_DIR (default ./spike-output).
 */

const fs = require('node:fs');
const path = require('node:path');
const { createTeamMatcher, normalizeTeamName } = require('../src/domain/teams/matching');

const OUT_DIR = process.env.SPIKE_OUT_DIR || 'spike-output';
const SECRETS = [process.env.FOOTBALL_DATA_ORG_KEY, process.env.ODDS_API_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean);

const FDCOUK_MAIN = ['E0', 'SC0', 'D1', 'I1', 'SP1', 'F1', 'N1', 'B1', 'P1', 'T1', 'G1'];
const FDCOUK_EXTRA = ['AUT', 'DNK', 'NOR', 'POL', 'ROU', 'SWE', 'SWZ', 'FIN', 'IRL', 'RUS'];

const redact = (t) => SECRETS.reduce((s, k) => s.split(k).join('[REDACTED]'), String(t));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(name, { maxRequests, delayMs }) {
  let count = 0;
  const log = [];
  async function get(url, headers = {}) {
    if (count >= maxRequests) throw new Error(`${name}: request cap reached (${maxRequests})`);
    if (count > 0) await sleep(delayMs);
    count += 1;
    const started = Date.now();
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      log.push({ url: redact(String(url).split('?')[0]), status: res.status, ms: Date.now() - started, bytes: text.length });
      return { status: res.status, text, headers: res.headers };
    } catch (err) {
      log.push({ url: redact(String(url).split('?')[0]), error: redact(err.message) });
      return { status: 0, text: '', error: redact(err.message) };
    }
  }
  return { get, log, count: () => count };
}

/** Minimal CSV parser (quoted fields, commas, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x !== '')) rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const json = (t) => { try { return JSON.parse(t); } catch (_) { return null; } };

async function cupClubs(report) {
  const clubs = new Map(); // name → { competitions:Set, country? }
  const add = (name, comp, country = null) => {
    if (!name) return;
    if (!clubs.has(name)) clubs.set(name, { competitions: new Set(), country: null });
    const c = clubs.get(name);
    c.competitions.add(comp);
    if (country && !c.country) c.country = country;
  };
  const sources = {};

  if (process.env.ODDS_API_KEY) {
    const odds = makeClient('the-odds-api', { maxRequests: 4, delayMs: 1500 });
    const base = 'https://api.the-odds-api.com/v4';
    const key = `apiKey=${encodeURIComponent(process.env.ODDS_API_KEY)}`;
    const sports = json((await odds.get(`${base}/sports?${key}`)).text) || [];
    for (const [comp, re] of [['UCL', /^uefa champions league$/i], ['UEL', /^uefa europa league$/i]]) {
      const s = sports.find((x) => re.test(x.title || ''));
      if (!s) { sources[`odds_events_${comp}`] = 'sport not listed'; continue; }
      const r = await odds.get(`${base}/sports/${s.key}/events?${key}`);
      const events = json(r.text) || [];
      sources[`odds_events_${comp}`] = { http: r.status, events: events.length, creditsLast: r.headers ? r.headers.get('x-requests-last') : null };
      for (const e of events) { add(e.home_team, comp); add(e.away_team, comp); }
    }
    report.requests.oddsApi = odds.log;
  } else sources.odds = 'skipped (no ODDS_API_KEY)';

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const sb = makeClient('supabase', { maxRequests: 2, delayMs: 200 });
    const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await sb.get(`${process.env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/odds_events?select=competition_code,home_team_name,away_team_name&competition_code=in.(UCL,UEL)`, { apikey: k, Authorization: `Bearer ${k}` });
    const rows = json(r.text) || [];
    sources.stored_odds_events = { http: r.status, events: rows.length };
    for (const e of rows) { add(e.home_team_name, e.competition_code); add(e.away_team_name, e.competition_code); }
    report.requests.supabase = sb.log;
  } else sources.stored = 'skipped (no Supabase credentials)';

  const fdTeams = [];
  if (process.env.FOOTBALL_DATA_ORG_KEY) {
    const fd = makeClient('football-data.org', { maxRequests: 8, delayMs: 7000 });
    const h = { 'X-Auth-Token': process.env.FOOTBALL_DATA_ORG_KEY };
    const r = await fd.get('https://api.football-data.org/v4/competitions/CL/teams', h);
    const body = json(r.text);
    const teams = (body && body.teams) || [];
    sources.fdorg_CL_teams = { http: r.status, teams: teams.length, season: body && body.season ? body.season.startDate : null };
    for (const t of teams) fdTeams.push({ name: t.name, shortName: t.shortName, country: t.area && t.area.name });
    report.fdorgClient = fd; // reused in section D (same request cap)
  } else sources.fdorg = 'skipped (no FOOTBALL_DATA_ORG_KEY)';

  // Attach countries from football-data.org CL teams where names match.
  const m = createTeamMatcher(fdTeams.map((t, i) => ({ id: String(i), names: [t.name, t.shortName] })));
  for (const [name, c] of clubs) {
    const r = m.match(name);
    if (r.teamId) c.country = fdTeams[Number(r.teamId)].country;
  }
  report.sections.A = { sources, clubs: clubs.size, byCompetition: { UCL: [...clubs.values()].filter((c) => c.competitions.has('UCL')).length, UEL: [...clubs.values()].filter((c) => c.competitions.has('UEL')).length } };
  return clubs;
}

async function clubElo(report, clubs, today) {
  const elo = makeClient('clubelo', { maxRequests: 4, delayMs: 2000 });
  const r = await elo.get(`http://api.clubelo.com/${today}`);
  const rows = r.status === 200 ? parseCsv(r.text) : [];
  const section = { http: r.status, error: r.error || null, clubs: rows.length, countries: new Set(rows.map((x) => x.Country)).size, columns: rows[0] ? Object.keys(rows[0]) : [] };
  const matcher = createTeamMatcher(rows.map((x) => ({ id: x.Club, names: [x.Club] })));
  const perClub = {};
  for (const name of clubs.keys()) {
    const m = matcher.match(name);
    perClub[name] = m.teamId ? { elo: m.teamId, method: m.method } : { elo: null, reason: m.reason, candidates: (m.candidates || []).slice(0, 4) };
  }
  section.matched = Object.values(perClub).filter((x) => x.elo).length;
  // History depth for one well-known club (needed for point-in-time ratings in backtests).
  const sample = rows.find((x) => /^benfica$/i.test(x.Club)) ? 'Benfica' : rows[0] && rows[0].Club;
  if (sample) {
    const h = await elo.get(`http://api.clubelo.com/${encodeURIComponent(sample)}`);
    const hist = h.status === 200 ? parseCsv(h.text) : [];
    section.historySample = { club: sample, http: h.status, rows: hist.length, from: hist[0] ? hist[0].From : null, to: hist.length ? hist[hist.length - 1].To : null };
  }
  report.sections.B = section;
  report.requests.clubelo = elo.log;
  return perClub;
}

async function fdcouk(report, clubs) {
  const c = makeClient('football-data.co.uk', { maxRequests: 40, delayMs: Number(process.env.SPIKE_DELAY_MS ?? 1200) });
  const base = 'https://www.football-data.co.uk';
  const datasets = [];
  for (const div of FDCOUK_MAIN) {
    let got = null;
    for (const season of ['2627', '2526']) {
      const r = await c.get(`${base}/mmz4281/${season}/${div}.csv`);
      if (r.status === 200) { got = { season, rows: parseCsv(r.text) }; break; }
    }
    const rows = got ? got.rows : [];
    datasets.push({ id: div, kind: 'main', season: got ? got.season : null, matches: rows.length, teams: [...new Set(rows.flatMap((x) => [x.HomeTeam, x.AwayTeam]).filter(Boolean))] });
  }
  for (const code of FDCOUK_EXTRA) {
    const r = await c.get(`${base}/new/${code}.csv`);
    const rows = r.status === 200 ? parseCsv(r.text) : [];
    const seasons = [...new Set(rows.map((x) => x.Season))].filter(Boolean).sort();
    const latest = seasons[seasons.length - 1] || null;
    const cur = rows.filter((x) => x.Season === latest);
    datasets.push({ id: code, kind: 'extra', http: r.status, seasons: seasons.length, latestSeason: latest, matches: cur.length, teams: [...new Set(cur.flatMap((x) => [x.Home, x.Away]).filter(Boolean))] });
  }
  const perClub = {};
  for (const name of clubs.keys()) {
    const hits = [];
    for (const d of datasets) {
      if (!d.teams.length) continue;
      const m = createTeamMatcher(d.teams.map((t) => ({ id: t, names: [t] }))).match(name);
      if (m.teamId) hits.push(d.id);
    }
    perClub[name] = hits;
  }
  report.sections.C = { datasets: datasets.map(({ teams, ...rest }) => ({ ...rest, teams: teams.length })), matched: Object.values(perClub).filter((h) => h.length).length };
  report.requests.fdcouk = c.log;
  return perClub;
}

async function uefaHistory(report) {
  const out = {};
  const fd = report.fdorgClient;
  if (fd) {
    const h = { 'X-Auth-Token': process.env.FOOTBALL_DATA_ORG_KEY };
    for (const [comp, season] of [['CL', 2025], ['CL', 2024], ['CL', 2023], ['EL', 2025]]) {
      const r = await fd.get(`https://api.football-data.org/v4/competitions/${comp}/matches?season=${season}`, h);
      const body = json(r.text);
      const matches = (body && body.matches) || [];
      out[`fdorg_${comp}_${season}`] = { http: r.status, matches: matches.length, finished: matches.filter((m) => m.status === 'FINISHED').length };
    }
    report.requests.fdorg = fd.log;
    delete report.fdorgClient;
  } else out.fdorg = 'skipped (no FOOTBALL_DATA_ORG_KEY)';

  const gh = makeClient('github', { maxRequests: 3, delayMs: 500 });
  for (const repo of ['openfootball/champions-league', 'openfootball/europe']) {
    const r = await gh.get(`https://api.github.com/repos/${repo}/contents/`, { 'User-Agent': 'fvis-spike' });
    const items = json(r.text);
    out[`github_${repo}`] = { http: r.status, entries: Array.isArray(items) ? items.map((x) => x.name).slice(0, 40) : null };
  }
  report.sections.D = out;
  report.requests.github = gh.log;
}

function summary(report, clubs, elo, dom) {
  const L = [];
  const p = (x) => L.push(x);
  p('# FVIS Phase 6a — cup cross-league feasibility (measurement only)');
  p('');
  p(`Run: ${report.startedAt}`);
  p('');
  p('## A. Clubs in UCL/UEL');
  p('```');
  p(JSON.stringify(report.sections.A, null, 2));
  p('```');
  p('## B. ClubElo');
  const { matched, ...b } = report.sections.B;
  p(`Matched cup clubs: **${matched} / ${clubs.size}**`);
  p('```');
  p(JSON.stringify(b, null, 2));
  p('```');
  p('## C. football-data.co.uk domestic data');
  p(`Cup clubs with a matching domestic dataset: **${report.sections.C.matched} / ${clubs.size}**`);
  p('');
  p('| Dataset | Kind | Season | Matches | Teams |');
  p('|---|---|---|---|---|');
  for (const d of report.sections.C.datasets) p(`| ${d.id} | ${d.kind} | ${d.season || d.latestSeason || '—'} | ${d.matches} | ${d.teams} |`);
  p('');
  p('## D. Historical UEFA results');
  p('```');
  p(JSON.stringify(report.sections.D, null, 2));
  p('```');
  p('## Per-club coverage');
  p('');
  p('| Club | Comp. | Country | ClubElo | Domestic data |');
  p('|---|---|---|---|---|');
  const names = [...clubs.keys()].sort((a, b2) => normalizeTeamName(a).localeCompare(normalizeTeamName(b2)));
  for (const n of names) {
    const c = clubs.get(n);
    const e = elo[n] || {};
    p(`| ${n} | ${[...c.competitions].join('+')} | ${c.country || '?'} | ${e.elo ? `${e.elo} (${e.method})` : `— ${e.reason || ''}`} | ${(dom[n] || []).join(', ') || '—'} |`);
  }
  const both = names.filter((n) => elo[n] && elo[n].elo && dom[n] && dom[n].length).length;
  p('');
  p(`**Coverage:** ClubElo ${report.sections.B.matched}/${clubs.size}; domestic data ${report.sections.C.matched}/${clubs.size}; both ${both}/${clubs.size}.`);
  return L.join('\n');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = { startedAt: new Date().toISOString(), sections: {}, requests: {} };
  const today = report.startedAt.slice(0, 10);
  const clubs = await cupClubs(report);
  const elo = await clubElo(report, clubs, today);
  const dom = await fdcouk(report, clubs);
  await uefaHistory(report);
  const md = summary(report, clubs, elo, dom);
  fs.writeFileSync(path.join(OUT_DIR, 'summary-6a.md'), `${md}\n`);
  fs.writeFileSync(path.join(OUT_DIR, 'report-6a.json'), `${redact(JSON.stringify({ ...report, clubs: Object.fromEntries([...clubs].map(([k, v]) => [k, { ...v, competitions: [...v.competitions] }])), elo, domestic: dom }, null, 2))}\n`);
  console.log(md);
}

main().catch((err) => {
  console.error(`Phase 6a probe aborted: ${redact(err.message)}`);
  process.exit(1);
});
