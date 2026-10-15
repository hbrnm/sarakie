'use strict';

const { COMPETITIONS, getCompetition } = require('../domain/competitions');
const { marketConsensus } = require('../domain/odds/consensus');
const { selectionLabel, reasonText } = require('../explain/labels');
const { DISCLAIMER } = require('../explain/template');
const { marketViewLines, CUP_NOTE } = require('../telegram/marketView');
const { bucharestDate, formatTime, DISPLAY_TIME_ZONE } = require('../time/format');
const { zonedTimeToUtc } = require('../time/zone');

const DOMESTIC = COMPETITIONS.filter((c) => c.modelApplicable).map((c) => c.code);
const CUPS = COMPETITIONS.filter((c) => !c.modelApplicable).map((c) => c.code);
const DAY = 86400000;

const pct = (p) => `${(p * 100).toFixed(1)}%`;
const signedPct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;

/** [start, end) of a Europe/Bucharest calendar day, offset in days from `now`. */
function bucharestDay(now, offsetDays = 0) {
  const [y, m, d] = bucharestDate(new Date(now.getTime() + offsetDays * DAY)).split('-').map(Number);
  const start = zonedTimeToUtc({ year: y, month: m, day: d }, DISPLAY_TIME_ZONE);
  const next = new Date(Date.UTC(y, m - 1, d) + DAY);
  const end = zonedTimeToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, DISPLAY_TIME_ZONE);
  return { start, end, label: `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}` };
}

/** Status lines of the latest stored analysis of one fixture (no computation, stored values only). */
function fixtureLines(rows) {
  if (!rows || !rows.length) return ['  neanalizat încă — /analyze pentru analiză cu cote proaspete'];
  const created = Date.parse(rows[0].created_at);
  const mode = rows[0].mode === 'on_demand' ? 'analiză la cerere' : 'scanare';
  const when = Number.isFinite(created) ? `${mode}, ${formatTime(new Date(created))}` : mode;
  const value = rows
    .filter((r) => r.status === 'QUALIFIED' || r.status === 'WATCHLIST')
    .sort((a, b) => (a.status === b.status ? b.ev - a.ev : a.status === 'QUALIFIED' ? -1 : 1));
  const out = [];
  for (const r of value) {
    const tag = r.status === 'QUALIFIED' ? 'ELIGIBIL (QUALIFIED)' : 'de urmărit (WATCHLIST)';
    out.push(`  ${tag}: ${selectionLabel(r.market_code, r.selection_code, r.line === null ? null : Number(r.line))} · cotă ${Number(r.decimal_odds).toFixed(2)} · model ${pct(r.p_model)} · EV ${signedPct(r.ev)}`);
    if (r.status === 'WATCHLIST' && r.reason_codes.length) out.push(`    condiții neîndeplinite: ${r.reason_codes.map(reasonText).join('; ')}`);
  }
  if (!out.length) {
    const priced = rows.filter((r) => r.status === 'NO_VALUE').length;
    if (priced) out.push('  fără valoare la cotele analizate');
    else {
      const reasons = [...new Set(rows.flatMap((r) => r.reason_codes))].filter((c) => c !== 'ODDS_NOT_FETCHED').slice(0, 3);
      out.push(`  date insuficiente${reasons.length ? `: ${reasons.map(reasonText).join('; ')}` : ''}`);
    }
  }
  out.push(`  (${when})`);
  return out;
}

/**
 * `/azi` (D-20): every match of a Bucharest calendar day in one message, from stored data
 * only (0 credits). Domestic leagues: the latest recorded FVIS analysis per fixture. UCL/UEL:
 * market-only view (D-19). Nothing is recalculated here.
 *
 * @param {{ store: object, now?: () => Date }} deps
 * @param {{ tomorrow?: boolean }} [options]
 * @returns {Promise<string>}
 */
async function todayReport({ store, now = () => new Date() }, { tomorrow = false } = {}) {
  const t = now();
  const day = bucharestDay(t, tomorrow ? 1 : 0);
  const fixtures = await store.upcomingFixtures({ from: day.start, to: day.end, competitionCodes: DOMESTIC, statuses: ['SCHEDULED', 'LIVE', 'FINISHED'] });
  const latest = await store.latestPredictions(fixtures.map((f) => f.id));
  const events = await store.upcomingOddsEvents({ from: day.start, to: day.end, competitionCodes: CUPS });
  const quotes = await store.loadEventQuotes({ eventIds: events.map((e) => e.providerEventId), since: new Date(t.getTime() - DAY) });

  const lines = [`FVIS — meciurile ${tomorrow ? 'de mâine' : 'de azi'}, ${day.label}`];
  if (!fixtures.length && !events.length) {
    lines.push('', 'Niciun meci în competițiile urmărite.');
    return lines.join('\n');
  }
  const byComp = new Map();
  for (const f of fixtures) {
    if (!byComp.has(f.competitionCode)) byComp.set(f.competitionCode, []);
    byComp.get(f.competitionCode).push(f);
  }
  for (const [code, list] of byComp) {
    lines.push('', getCompetition(code).name);
    for (const f of list) {
      const status = f.status === 'FINISHED' ? ` — terminat ${f.homeGoals}-${f.awayGoals}` : f.status === 'LIVE' ? ' — în desfășurare' : '';
      lines.push(`• ${formatTime(new Date(f.kickoffUtc))} ${await store.teamName(f.homeTeamId)} – ${await store.teamName(f.awayTeamId)}${status}`);
      lines.push(...fixtureLines(latest.get(f.id)));
    }
  }
  if (events.length) {
    lines.push('', 'CUPE EUROPENE — DOAR PIAȚA (informativ)');
    for (const event of events) lines.push(...marketViewLines({ event, consensus: marketConsensus(quotes.filter((q) => q.providerEventId === event.providerEventId)) }));
    lines.push(CUP_NOTE);
  }
  if (fixtures.length) lines.push('', `Valori din ultima analiză salvată; pentru cote proaspete folosește /analyze. ${DISCLAIMER}`);
  return lines.join('\n');
}

module.exports = { todayReport, bucharestDay };
