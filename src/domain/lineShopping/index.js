'use strict';

const { devig } = require('../odds');
const { isValidDecimalOdds } = require('../markets');
const { defaultLineConfig } = require('./config');

const SELECTIONS = Object.freeze(['HOME', 'DRAW', 'AWAY']);
const SCOPES = Object.freeze(['all', 'playable']);

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Line shopping on the 1X2 market of one fixture (D-24, docs/23 §2). Pure and deterministic:
 * the order of the quotes does not matter (ties are broken by bookmaker key).
 *
 * - Probability: Pinnacle's latest complete 1X2 set, de-vigged proportionally (CLAUDE.md §6).
 * - Price: the best latest price among the other bookmakers (exchanges and aggregates
 *   excluded), for two scopes: `all` bookmakers and `playable` (PO-available) bookmakers.
 * - Edge = p_pin × price − 1. The median (of the bookmakers other than the one giving the
 *   price) and the depth are taken over all bookmakers in both scopes: they describe the
 *   market, not where the price comes from. With no other bookmaker the median is null and
 *   the THIN_MARKET gate applies.
 *
 * Status per selection and scope: LINE_VALUE (every gate passed), WATCHLIST (positive edge,
 * one or more gates failed), NO_VALUE (edge ≤ 0), INSUFFICIENT_DATA (no reference or no price).
 *
 * @param {{
 *   quotes: import('../types').OddsQuote[],
 *   kickoffUtc: string,
 *   now: Date,
 *   config?: ReturnType<typeof defaultLineConfig>,
 * }} input
 */
function evaluateLineShopping({ quotes, kickoffUtc, now, config = defaultLineConfig() }) {
  const minCaptured = now.getTime() - config.maxOddsAgeMinutes * 60000;
  const fresh = quotes.filter(
    (q) => (q.kind ?? 'pre_match') === 'pre_match' && q.marketCode === '1X2' && SELECTIONS.includes(q.selectionCode) &&
      isValidDecimalOdds(q.decimalOdds) && Date.parse(q.capturedAt) >= minCaptured && Date.parse(q.capturedAt) <= now.getTime(),
  );

  // Sharp reference: the latest capture time at which Pinnacle has all three selections.
  const sharp = fresh.filter((q) => q.bookmakerKey === config.sharpBookmaker);
  const byTime = new Map();
  for (const q of sharp) {
    if (!byTime.has(q.capturedAt)) byTime.set(q.capturedAt, new Map());
    const cur = byTime.get(q.capturedAt).get(q.selectionCode);
    if (!cur || (q.snapshotId ?? 0) > (cur.snapshotId ?? 0)) byTime.get(q.capturedAt).set(q.selectionCode, q);
  }
  const times = [...byTime.keys()].filter((t) => byTime.get(t).size === 3).sort((a, b) => Date.parse(b) - Date.parse(a));
  let reference = null;
  if (times.length) {
    const set = byTime.get(times[0]);
    const d = devig('1X2', Object.fromEntries(SELECTIONS.map((s) => [s, set.get(s).decimalOdds])));
    if (d.complete) {
      reference = {
        capturedAt: times[0],
        odds: Object.fromEntries(SELECTIONS.map((s) => [s, set.get(s).decimalOdds])),
        snapshotIds: Object.fromEntries(SELECTIONS.map((s) => [s, set.get(s).snapshotId ?? null])),
        pFair: d.pFair,
        overround: d.overround,
      };
    }
  }

  // Latest price of each other bookmaker per selection.
  const excluded = new Set([config.sharpBookmaker, ...config.excludedBookmakers]);
  const latest = new Map();
  for (const q of fresh) {
    if (excluded.has(q.bookmakerKey)) continue;
    const k = `${q.bookmakerKey}|${q.selectionCode}`;
    const cur = latest.get(k);
    if (!cur || Date.parse(q.capturedAt) > Date.parse(cur.capturedAt) || (q.capturedAt === cur.capturedAt && (q.snapshotId ?? 0) > (cur.snapshotId ?? 0))) latest.set(k, q);
  }
  const playable = (key) => config.playableBookmakerPrefixes.some((p) => key === p || key.startsWith(`${p}_`));
  const leadOk = reference ? Date.parse(kickoffUtc) - Date.parse(reference.capturedAt) >= config.minLeadTimeMinutes * 60000 : false;

  const selections = [];
  for (const sel of SELECTIONS) {
    const prices = [...latest.values()].filter((q) => q.selectionCode === sel);
    for (const scope of SCOPES) {
      const pool = scope === 'all' ? prices : prices.filter((q) => playable(q.bookmakerKey));
      // Best price; ties go to the alphabetically first bookmaker (deterministic).
      const best = pool.reduce((b, q) => (!b || q.decimalOdds > b.decimalOdds || (q.decimalOdds === b.decimalOdds && q.bookmakerKey < b.bookmakerKey) ? q : b), null);
      const med = best ? median(prices.filter((q) => q !== best).map((q) => q.decimalOdds)) : null; // the other bookmakers' median
      const row = {
        scope,
        marketCode: '1X2',
        selectionCode: sel,
        pinOdds: reference ? reference.odds[sel] : null,
        pinSnapshotId: reference ? reference.snapshotIds[sel] : null,
        pPin: reference ? reference.pFair[sel] : null,
        pinOverround: reference ? reference.overround : null,
        pinCapturedAt: reference ? reference.capturedAt : null,
        bookmakerKey: best ? best.bookmakerKey : null,
        price: best ? best.decimalOdds : null,
        priceSnapshotId: best ? best.snapshotId ?? null : null,
        medianPrice: med,
        nPrices: prices.length,
        edge: null,
        status: 'INSUFFICIENT_DATA',
        reasonCodes: [],
      };
      if (!reference) row.reasonCodes.push('NO_SHARP_REFERENCE');
      if (!best) row.reasonCodes.push(scope === 'all' ? 'NO_PRICE' : 'NO_PLAYABLE_PRICE');
      if (reference && best) {
        row.edge = reference.pFair[sel] * best.decimalOdds - 1;
        if (row.edge <= 0) {
          row.status = 'NO_VALUE';
        } else {
          if (row.edge < config.minEdge) row.reasonCodes.push('EDGE_BELOW_MIN');
          if (med !== null && best.decimalOdds < config.minPriceOverMedian * med) row.reasonCodes.push('SHARP_OUTLIER');
          if (best.decimalOdds < config.minOdds || best.decimalOdds > config.maxOdds) row.reasonCodes.push('ODDS_OUT_OF_RANGE');
          if (prices.length < config.minPrices) row.reasonCodes.push('THIN_MARKET');
          if (!leadOk) row.reasonCodes.push('KICKOFF_TOO_CLOSE');
          row.status = row.reasonCodes.length ? 'WATCHLIST' : 'LINE_VALUE';
        }
      }
      selections.push(row);
    }
  }
  return { reference, selections };
}

/**
 * Paper settlement of a line candidate (1 notional unit) with closing-line measures.
 * CLV = price / Pinnacle close − 1; close-EV = p_close × price − 1, p_close from the
 * de-vigged Pinnacle closing 1X2 set (docs/23 §3). Without a complete closing set both are null.
 *
 * @param {{ selectionCode: string, price: number }} candidate
 * @param {{ status: string, homeGoals: number|null, awayGoals: number|null }} fixture
 * @param {{ HOME: number, DRAW: number, AWAY: number } | null} closing Pinnacle closing odds
 * @returns {{ result: 'WIN'|'LOSS'|'VOID', profit: number|null, closeOdds: number|null, pClose: number|null, clv: number|null, closeEv: number|null } | null}
 */
function settleLineCandidate(candidate, fixture, closing) {
  let result;
  if (fixture.status === 'CANCELLED' || fixture.status === 'AWARDED') result = 'VOID';
  else if (fixture.status !== 'FINISHED' || !Number.isInteger(fixture.homeGoals) || !Number.isInteger(fixture.awayGoals)) return null;
  else {
    const h = fixture.homeGoals;
    const a = fixture.awayGoals;
    const won = { HOME: h > a, DRAW: h === a, AWAY: a > h }[candidate.selectionCode];
    if (won === undefined) throw new RangeError(`unknown selection: ${candidate.selectionCode}`);
    result = won ? 'WIN' : 'LOSS';
  }
  const profit = result === 'VOID' ? null : result === 'WIN' ? candidate.price - 1 : -1;
  const d = closing && result !== 'VOID' ? devig('1X2', closing) : { complete: false };
  if (!d.complete) return { result, profit, closeOdds: null, pClose: null, clv: null, closeEv: null };
  const closeOdds = closing[candidate.selectionCode];
  const pClose = d.pFair[candidate.selectionCode];
  return { result, profit, closeOdds, pClose, clv: candidate.price / closeOdds - 1, closeEv: pClose * candidate.price - 1 };
}

/**
 * Mean with a normal-approximation 95% confidence interval (mean ± 1.96 · s / √n).
 * Treats observations as independent; selections of the same match are not, so the
 * interval is approximate (docs/23 §5).
 * @param {number[]} values
 */
function meanCi(values) {
  const n = values.length;
  if (!n) return { n: 0, mean: null, low: null, high: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, low: null, high: null };
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  const half = (1.96 * sd) / Math.sqrt(n);
  return { n, mean, low: mean - half, high: mean + half };
}

module.exports = { evaluateLineShopping, settleLineCandidate, meanCi, median, SCOPES };
