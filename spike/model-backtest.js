'use strict';

/**
 * FVIS Phase 6b — comparative model backtest (measurement only, docs/12-validation-plan.md).
 *
 * Walk-forward over football-data.co.uk seasons for the 5 domestic leagues. For every match,
 * each model sees only matches played before the match's UTC calendar day (no same-day or
 * future data). Compared on 1X2 and Over/Under 2.5:
 *
 *   BASE        league base rates (last 380 matches)
 *   FVIS v1     the production engine, src/domain/model/estimate.js, default config (k = 8)
 *   FVIS k=…    the same engine with another shrinkage k (tuned)
 *   PO ξ=…      weighted Poisson maximum likelihood (attack/defence/home), time decay ξ per day
 *   DC ξ=…      PO plus the Dixon-Coles low-score correction ρ
 *   BLEND       best tuned model mixed with the Pinnacle pre-match de-vigged probabilities
 *   PIN_PRE     Pinnacle pre-match odds (collected before the match day), de-vigged
 *   PIN_CLOSE   Pinnacle closing odds, de-vigged (not available at prediction time: reference)
 *
 * Tuning seasons choose k, ξ and the blend weight; the test seasons are reported once.
 * Nothing here is imported by application code and nothing is written to the database.
 *
 * Env: BACKTEST_DATA_DIR (local CSVs <dir>/<season code>/<division>.csv instead of download),
 *      BACKTEST_FIRST_SEASON (2019), BACKTEST_LAST_SEASON (2025), BACKTEST_TEST_FROM (2024),
 *      BACKTEST_OUT_DIR (spike-output).
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseCsv, parseKickoff, seasonCode, DIVISIONS } = require('../src/providers/footballDataCoUk');
const { estimate } = require('../src/domain/model/estimate');
const { defaultConfig } = require('../src/domain/model/config');

const LEAGUES = ['EPL', 'LALIGA', 'SERIEA', 'BUNDESLIGA', 'LIGUE1'];
const FIRST = Number(process.env.BACKTEST_FIRST_SEASON || 2019);
const LAST = Number(process.env.BACKTEST_LAST_SEASON || 2025);
const TEST_FROM = Number(process.env.BACKTEST_TEST_FROM || 2024);
const EVAL_FROM = FIRST + 1; // the first season is history only
const OUT_DIR = process.env.BACKTEST_OUT_DIR || 'spike-output';
const DATA_DIR = process.env.BACKTEST_DATA_DIR || null;

const DAY = 86400000;
const K_GRID = [2, 4, 8, 16, 32];
const XI_GRID = [0, 0.001, 0.002, 0.003, 0.005];
const BLEND_GRID = [0, 0.1, 0.2, 0.3, 0.5];
const PO_WINDOW_DAYS = 730;
const PO_PSEUDO_MATCHES = 2; // pseudo-matches per team against an average opponent (shrinkage)
const MIN_TEAM_MATCHES = 5; // same floor as FVIS nTeamMin
const MIN_LEAGUE_MATCHES = 150; // same floor as FVIS nLeagueMin
const MAX_GOALS = 12;
// FVIS-like selection rule (src/domain/risk/config.js 1.1.0, the parts that exist in this data).
const RULE = { evMin: 0.05, pMin: 0.15, oddsMin: 1.3, oddsMax: 6, divergenceMax: 0.12 };

// ---------- data ----------

const num = (s) => {
  if (s === undefined || s === null || String(s).trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const validOdds = (arr) => arr.every((o) => o !== null && o > 1 && o <= 1000);

async function fetchText(url) {
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'fvis-backtest (research, low volume)' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw new Error(`download failed ${url}: ${last && last.message}`);
}

async function loadSeason(code, season) {
  const sc = seasonCode(season);
  const div = DIVISIONS[code];
  if (DATA_DIR) {
    const file = path.join(DATA_DIR, sc, `${div}.csv`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }
  const text = await fetchText(`https://www.football-data.co.uk/mmz4281/${sc}/${div}.csv`);
  await new Promise((r) => setTimeout(r, 1500)); // polite spacing
  return text;
}

function parseMatches(text, code, season) {
  const rows = parseCsv(text);
  const header = (rows[0] || []).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const get = (row, name) => (idx[name] === undefined ? null : num(row[idx[name]]));
  const triple = (row, prefix) => ['H', 'D', 'A'].map((s) => get(row, `${prefix}${s}`));
  const pair = (row, o, u) => [get(row, o), get(row, u)];
  const out = [];
  let dropped = 0;
  for (const row of rows.slice(1)) {
    const home = (row[idx.HomeTeam] || '').trim();
    const away = (row[idx.AwayTeam] || '').trim();
    const kickoffUtc = parseKickoff(row[idx.Date], idx.Time === undefined ? undefined : row[idx.Time]);
    const hg = get(row, 'FTHG');
    const ag = get(row, 'FTAG');
    if (!home || !away || home === away || !kickoffUtc || !Number.isInteger(hg) || !Number.isInteger(ag) || hg < 0 || ag < 0) {
      dropped += 1;
      continue;
    }
    out.push({
      competitionCode: code,
      season,
      kickoffUtc,
      ko: Date.parse(kickoffUtc),
      homeTeamId: home,
      awayTeamId: away,
      homeGoals: hg,
      awayGoals: ag,
      odds: {
        pinPre: triple(row, 'PS'),
        pinClose: triple(row, 'PSC'),
        maxPre: triple(row, 'Max'),
        maxClose: triple(row, 'MaxC'),
        ouPinPre: pair(row, 'P>2.5', 'P<2.5'),
        ouPinClose: pair(row, 'PC>2.5', 'PC<2.5'),
        ouMaxPre: pair(row, 'Max>2.5', 'Max<2.5'),
        ouMaxClose: pair(row, 'MaxC>2.5', 'MaxC<2.5'),
      },
    });
  }
  return { matches: out, dropped };
}

// ---------- models ----------

const devig = (odds) => {
  const raw = odds.map((o) => 1 / o);
  const s = raw.reduce((a, b) => a + b, 0);
  return raw.map((r) => r / s);
};

function baseRates(histDesc) {
  const w = histDesc.slice(0, 380);
  if (w.length < MIN_LEAGUE_MATCHES) return null;
  let h = 0;
  let d = 0;
  let over = 0;
  for (const m of w) {
    if (m.homeGoals > m.awayGoals) h += 1;
    else if (m.homeGoals === m.awayGoals) d += 1;
    if (m.homeGoals + m.awayGoals > 2.5) over += 1;
  }
  const n = w.length;
  return { h: h / n, d: d / n, a: (n - h - d) / n, over: over / n };
}

function fvis(target, histDesc, asOfIso, k) {
  const config = { ...defaultConfig(), shrinkageK: k };
  const fixture = { competitionCode: target.competitionCode, season: target.season, kickoffUtc: target.kickoffUtc, homeTeamId: target.homeTeamId, awayTeamId: target.awayTeamId };
  const e = estimate({ fixture, history: histDesc, asOf: asOfIso, config });
  if (e.status !== 'OK') return null;
  const x = e.markets['1X2'];
  return { h: x.HOME.p, d: x.DRAW.p, a: x.AWAY.p, over: e.markets.OU['2.5'].OVER.p };
}

/**
 * Weighted Poisson MLE (λ_home = γ·a_home·d_away, λ_away = a_away·d_home) by exact block
 * coordinate ascent: attack block, defence block, then γ, each the closed-form conditional
 * maximum, so the likelihood never decreases. Each team also plays PO_PSEUDO_MATCHES
 * pseudo-matches (half home, half away) against a fixed average opponent (a = d = 1) scoring
 * the league's weighted average goals; this anchors the scale and shrinks small samples
 * toward strength 1. The Dixon-Coles ρ is then fitted with λ, μ held fixed.
 */
function fitPoisson(window, asOfMs, xi) {
  const teams = new Map();
  const team = (id) => {
    if (!teams.has(id)) teams.set(id, { a: 1, d: 1, n: 0 });
    return teams.get(id);
  };
  let wSum = 0;
  let hgSum = 0;
  let agSum = 0;
  const rows = window.map((m) => {
    const h = team(m.homeTeamId);
    const a = team(m.awayTeamId);
    h.n += 1;
    a.n += 1;
    const w = Math.exp((-xi * (asOfMs - m.ko)) / DAY);
    wSum += w;
    hgSum += w * m.homeGoals;
    agSum += w * m.awayGoals;
    return { h, a, hg: m.homeGoals, ag: m.awayGoals, w };
  });
  const muH = hgSum / wSum;
  const muA = agSum / wSum;
  const half = PO_PSEUDO_MATCHES / 2;
  const list = [...teams.values()];
  let gamma = muH / muA;
  for (let iter = 0; iter < 1000; iter += 1) {
    let change = 0;
    // Attack block: a_i = goals for / expected-for multiplier (depends on d and γ only).
    const gf = new Map(list.map((t) => [t, [half * (muH + muA), half * (gamma + 1)]]));
    for (const r of rows) {
      gf.get(r.h)[0] += r.w * r.hg;
      gf.get(r.h)[1] += r.w * gamma * r.a.d;
      gf.get(r.a)[0] += r.w * r.ag;
      gf.get(r.a)[1] += r.w * r.h.d;
    }
    for (const [t, [g, e]] of gf) {
      change = Math.max(change, Math.abs(g / e - t.a));
      t.a = g / e;
    }
    // Defence block (uses the new attacks).
    const ga = new Map(list.map((t) => [t, [half * (muA + muH), half * (1 + gamma)]]));
    for (const r of rows) {
      ga.get(r.h)[0] += r.w * r.ag;
      ga.get(r.h)[1] += r.w * r.a.a;
      ga.get(r.a)[0] += r.w * r.hg;
      ga.get(r.a)[1] += r.w * gamma * r.h.a;
    }
    for (const [t, [g, e]] of ga) {
      change = Math.max(change, Math.abs(g / e - t.d));
      t.d = g / e;
    }
    // Home factor.
    let num = 0;
    let den = 0;
    for (const t of list) {
      num += 2 * half * muH;
      den += half * (t.a + t.d);
    }
    for (const r of rows) {
      num += r.w * r.hg;
      den += r.w * r.h.a * r.a.d;
    }
    change = Math.max(change, Math.abs(num / den - gamma));
    gamma = num / den;
    if (change < 1e-7) break;
  }
  // ρ: weighted likelihood of the τ factor with λ, μ held at the Poisson fit (two-step DC).
  const lm = rows.map((r) => ({ l: gamma * r.h.a * r.a.d, m: r.a.a * r.h.d, x: r.hg, y: r.ag, w: r.w }));
  let lo = -0.3;
  let hi = 0.3;
  for (const r of lm) {
    lo = Math.max(lo, -1 / r.l, -1 / r.m);
    hi = Math.min(hi, 1 / (r.l * r.m));
  }
  lo += 1e-6;
  hi -= 1e-6;
  const ll = (rho) => {
    let s = 0;
    for (const r of lm) if (r.x <= 1 && r.y <= 1) s += r.w * Math.log(tau(r.x, r.y, r.l, r.m, rho));
    return s;
  };
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 80; i += 1) {
    const c = b - g * (b - a);
    const d = a + g * (b - a);
    if (ll(c) > ll(d)) b = d;
    else a = c;
  }
  return { teams, gamma, rho: (a + b) / 2 };
}

function tau(x, y, l, m, rho) {
  if (x === 0 && y === 0) return 1 - l * m * rho;
  if (x === 0 && y === 1) return 1 + l * rho;
  if (x === 1 && y === 0) return 1 + m * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function pmf(l) {
  const p = [Math.exp(-l)];
  for (let k = 1; k <= MAX_GOALS; k += 1) p.push((p[k - 1] * l) / k);
  return p;
}

function predictPoisson(fit, home, away, withRho) {
  const th = fit.teams.get(home);
  const ta = fit.teams.get(away);
  if (!th || !ta || th.n < MIN_TEAM_MATCHES || ta.n < MIN_TEAM_MATCHES) return null;
  const l = fit.gamma * th.a * ta.d;
  const m = ta.a * th.d;
  const ph = pmf(l);
  const pa = pmf(m);
  const rho = withRho ? fit.rho : 0;
  let h = 0;
  let d = 0;
  let a = 0;
  let over = 0;
  let total = 0;
  for (let x = 0; x <= MAX_GOALS; x += 1) {
    for (let y = 0; y <= MAX_GOALS; y += 1) {
      const p = ph[x] * pa[y] * tau(x, y, l, m, rho);
      total += p;
      if (x > y) h += p;
      else if (x === y) d += p;
      else a += p;
      if (x + y > 2.5) over += p;
    }
  }
  return { h: h / total, d: d / total, a: a / total, over: over / total };
}

// ---------- metrics ----------

const EPS = 1e-12;
const outcome = (m) => (m.homeGoals > m.awayGoals ? 0 : m.homeGoals === m.awayGoals ? 1 : 2);
const isOver = (m) => (m.homeGoals + m.awayGoals > 2.5 ? 1 : 0);
const vec = (p) => [p.h, p.d, p.a];
const ll1x2 = (p, m) => -Math.log(Math.max(vec(p)[outcome(m)], EPS));
const brier1x2 = (p, m) => vec(p).reduce((s, q, i) => s + (q - (i === outcome(m) ? 1 : 0)) ** 2, 0);
const llOu = (p, m) => -Math.log(Math.max(isOver(m) ? p.over : 1 - p.over, EPS));
const brierOu = (p, m) => (p.over - isOver(m)) ** 2;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap 95% CI of the mean (deterministic seed). */
function bootCI(xs, iters = 2000, seed = 6) {
  if (xs.length < 2) return [NaN, NaN];
  const r = rng(seed);
  const means = [];
  for (let i = 0; i < iters; i += 1) {
    let s = 0;
    for (let j = 0; j < xs.length; j += 1) s += xs[Math.floor(r() * xs.length)];
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * iters)], means[Math.floor(0.975 * iters)]];
}

function calibration(records, model, key, bins = 10) {
  const pts = records.map((r) => {
    const p = r.preds[model];
    const pred = key === 'over' ? p.over : vec(p)[{ h: 0, d: 1, a: 2 }[key]];
    const y = key === 'over' ? isOver(r.m) : outcome(r.m) === { h: 0, d: 1, a: 2 }[key] ? 1 : 0;
    return { pred, y };
  });
  pts.sort((a, b) => a.pred - b.pred);
  const out = [];
  for (let b = 0; b < bins; b += 1) {
    const slice = pts.slice(Math.floor((b * pts.length) / bins), Math.floor(((b + 1) * pts.length) / bins));
    if (!slice.length) continue;
    out.push({ n: slice.length, predicted: mean(slice.map((x) => x.pred)), observed: mean(slice.map((x) => x.y)) });
  }
  const ece = out.reduce((s, b) => s + (b.n * Math.abs(b.predicted - b.observed)) / pts.length, 0);
  return { bins: out, ece };
}

function scores(records, model, withOu) {
  const ps = records.map((r) => [r.preds[model], r.m]);
  const res = { n: ps.length, ll1x2: mean(ps.map(([p, m]) => ll1x2(p, m))), brier1x2: mean(ps.map(([p, m]) => brier1x2(p, m))) };
  if (withOu) {
    const ou = records.filter((r) => r.ouOk).map((r) => [r.preds[model], r.m]);
    Object.assign(res, { nOu: ou.length, llOu: mean(ou.map(([p, m]) => llOu(p, m))), brierOu: mean(ou.map(([p, m]) => brierOu(p, m))) });
  }
  return res;
}

/** FVIS-like paper selections priced at the pre-match odds of `book`, judged against the close. */
function valueSim(records, model, book) {
  const bets = [];
  for (const r of records) {
    const p = r.preds[model];
    const pin = r.preds.PIN_PRE;
    const o = r.m.odds;
    const sels = [
      { p: p.h, pm: pin.h, pre: o[`${book}Pre`][0], close: o[`${book}Close`][0], pc: r.preds.PIN_CLOSE.h, win: outcome(r.m) === 0 },
      { p: p.d, pm: pin.d, pre: o[`${book}Pre`][1], close: o[`${book}Close`][1], pc: r.preds.PIN_CLOSE.d, win: outcome(r.m) === 1 },
      { p: p.a, pm: pin.a, pre: o[`${book}Pre`][2], close: o[`${book}Close`][2], pc: r.preds.PIN_CLOSE.a, win: outcome(r.m) === 2 },
    ];
    if (r.ouOk) {
      const ouBook = book === 'pin' ? 'ouPin' : 'ouMax';
      const pre = o[`${ouBook}Pre`];
      const close = o[`${ouBook}Close`];
      if (validOdds(pre) && validOdds(close)) {
        sels.push({ p: p.over, pm: r.preds.PIN_PRE.over, pre: pre[0], close: close[0], pc: r.preds.PIN_CLOSE.over, win: isOver(r.m) === 1 });
        sels.push({ p: 1 - p.over, pm: 1 - r.preds.PIN_PRE.over, pre: pre[1], close: close[1], pc: 1 - r.preds.PIN_CLOSE.over, win: isOver(r.m) === 0 });
      }
    }
    for (const s of sels) {
      if (!Number.isFinite(s.p) || !(s.pre > 1) || !(s.close > 1)) continue;
      const ev = s.p * s.pre - 1;
      if (ev < RULE.evMin || s.p < RULE.pMin || s.pre < RULE.oddsMin || s.pre > RULE.oddsMax || Math.abs(s.p - s.pm) > RULE.divergenceMax) continue;
      bets.push({ profit: s.win ? s.pre - 1 : -1, clv: s.pre / s.close - 1, closeEv: s.pc * s.pre - 1, ev });
    }
  }
  const profits = bets.map((b) => b.profit);
  const closeEvs = bets.map((b) => b.closeEv);
  return {
    bets: bets.length,
    meanModelEv: mean(bets.map((b) => b.ev)),
    roi: mean(profits),
    roiCI: bootCI(profits, 2000, 11),
    meanClv: mean(bets.map((b) => b.clv)),
    beatClose: mean(bets.map((b) => (b.clv > 0 ? 1 : 0))),
    closeEv: mean(closeEvs),
    closeEvCI: bootCI(closeEvs, 2000, 12),
  };
}

// ---------- run ----------

async function main() {
  const started = Date.now();
  const load = [];
  const byLeague = new Map();
  for (const code of LEAGUES) {
    const list = [];
    for (let season = FIRST; season <= LAST; season += 1) {
      const text = await loadSeason(code, season);
      if (!text) {
        load.push({ code, season, matches: 0, missing: true });
        continue;
      }
      const { matches, dropped } = parseMatches(text, code, season);
      load.push({ code, season, matches: matches.length, dropped, pinPre: matches.filter((m) => validOdds(m.odds.pinPre)).length, pinClose: matches.filter((m) => validOdds(m.odds.pinClose)).length, ouPinClose: matches.filter((m) => validOdds(m.odds.ouPinClose)).length });
      list.push(...matches);
    }
    list.sort((a, b) => a.ko - b.ko || (a.homeTeamId < b.homeTeamId ? -1 : 1));
    byLeague.set(code, list);
  }

  const fvisModels = K_GRID.map((k) => `FVIS k=${k}`);
  const poModels = XI_GRID.map((x) => `PO ξ=${x}`);
  const dcModels = XI_GRID.map((x) => `DC ξ=${x}`);
  const records = [];
  let considered = 0;
  for (const [, list] of byLeague) {
    // Group the evaluated matches by their prediction cut-off (UTC midnight of the match day).
    const groups = new Map();
    for (const m of list) {
      if (m.season < EVAL_FROM) continue;
      const cut = Math.min(Math.floor(m.ko / DAY) * DAY, m.ko);
      if (!groups.has(cut)) groups.set(cut, []);
      groups.get(cut).push(m);
    }
    for (const [cut, targets] of [...groups].sort((a, b) => a[0] - b[0])) {
      const hist = list.filter((m) => m.ko < cut);
      const histDesc = hist.slice().reverse();
      const base = baseRates(histDesc);
      const window = hist.filter((m) => m.ko >= cut - PO_WINDOW_DAYS * DAY);
      const fits = window.length >= MIN_LEAGUE_MATCHES ? XI_GRID.map((xi) => fitPoisson(window, cut, xi)) : null;
      const asOfIso = new Date(cut).toISOString();
      for (const m of targets) {
        considered += 1;
        const preds = { BASE: base };
        K_GRID.forEach((k, i) => (preds[fvisModels[i]] = fvis(m, histDesc, asOfIso, k)));
        XI_GRID.forEach((_, i) => {
          preds[poModels[i]] = fits ? predictPoisson(fits[i], m.homeTeamId, m.awayTeamId, false) : null;
          preds[dcModels[i]] = fits ? predictPoisson(fits[i], m.homeTeamId, m.awayTeamId, true) : null;
        });
        if (validOdds(m.odds.pinPre) && validOdds(m.odds.pinClose)) {
          const pre = devig(m.odds.pinPre);
          const close = devig(m.odds.pinClose);
          const ouOk = validOdds(m.odds.ouPinPre) && validOdds(m.odds.ouPinClose);
          const ouPre = ouOk ? devig(m.odds.ouPinPre)[0] : null;
          const ouClose = ouOk ? devig(m.odds.ouPinClose)[0] : null;
          preds.PIN_PRE = { h: pre[0], d: pre[1], a: pre[2], over: ouPre };
          preds.PIN_CLOSE = { h: close[0], d: close[1], a: close[2], over: ouClose };
          if (Object.values(preds).every(Boolean)) records.push({ m, preds, ouOk, rho: fits.map((f) => f.rho) });
        }
      }
    }
  }

  const tune = records.filter((r) => r.m.season < TEST_FROM);
  const test = records.filter((r) => r.m.season >= TEST_FROM);
  const pick = (models) => models.map((name) => ({ name, ...scores(tune, name, true) })).sort((a, b) => a.ll1x2 - b.ll1x2);
  const tuning = { FVIS: pick(fvisModels), PO: pick(poModels), DC: pick(dcModels) };
  const best = { FVIS: tuning.FVIS[0].name, PO: tuning.PO[0].name, DC: tuning.DC[0].name };
  const bestModel = [best.FVIS, best.PO, best.DC].map((n) => ({ n, ll: scores(tune, n, false).ll1x2 })).sort((a, b) => a.ll - b.ll)[0].n;

  const mix = (p, q, w) => ({ h: w * p.h + (1 - w) * q.h, d: w * p.d + (1 - w) * q.d, a: w * p.a + (1 - w) * q.a, over: q.over === null ? p.over : w * p.over + (1 - w) * q.over });
  const blendTune = BLEND_GRID.map((w) => {
    for (const r of tune) r.preds.BLEND = mix(r.preds[bestModel], r.preds.PIN_PRE, w);
    return { w, ...scores(tune, 'BLEND', true) };
  }).sort((a, b) => a.ll1x2 - b.ll1x2);
  const blendW = blendTune[0].w;
  for (const r of records) r.preds.BLEND = mix(r.preds[bestModel], r.preds.PIN_PRE, blendW);
  // For O/U rows without Pinnacle O/U odds the market side is absent; those rows are outside the O/U subset anyway.

  const report = ['BASE', 'FVIS k=8', best.FVIS, best.PO, best.DC, 'BLEND', 'PIN_PRE', 'PIN_CLOSE'].filter((v, i, a) => a.indexOf(v) === i);
  const label = (n) => (n === 'FVIS k=8' ? 'FVIS v1 (k=8, production)' : n === 'BLEND' ? `BLEND (${blendW} × ${bestModel} + ${1 - blendW} × PIN_PRE)` : n);
  const evalSet = (set) => Object.fromEntries(report.map((n) => [n, scores(set, n, true)]));
  const testScores = evalSet(test);
  const tuneScores = evalSet(tune);
  const pinPreLl = test.map((r) => ll1x2(r.preds.PIN_PRE, r.m));
  const diffs = Object.fromEntries(report.filter((n) => n !== 'PIN_PRE').map((n) => {
    const d = test.map((r, i) => ll1x2(r.preds[n], r.m) - pinPreLl[i]);
    return [n, { mean: mean(d), ci: bootCI(d, 2000, 7) }];
  }));
  const ouTest = test.filter((r) => r.ouOk);
  const pinPreOu = ouTest.map((r) => llOu(r.preds.PIN_PRE, r.m));
  const diffsOu = Object.fromEntries(report.filter((n) => n !== 'PIN_PRE').map((n) => {
    const d = ouTest.map((r, i) => llOu(r.preds[n], r.m) - pinPreOu[i]);
    return [n, { mean: mean(d), ci: bootCI(d, 2000, 8) }];
  }));
  const byLeagueScores = Object.fromEntries(LEAGUES.map((c) => [c, evalSet(test.filter((r) => r.m.competitionCode === c))]));
  const bySeasonScores = Object.fromEntries([...new Set(records.map((r) => r.m.season))].sort().map((s) => [s, evalSet(records.filter((r) => r.m.season === s))]));
  const draws = Object.fromEntries(report.map((n) => [n, { predicted: mean(test.map((r) => r.preds[n].d)), observed: mean(test.map((r) => (outcome(r.m) === 1 ? 1 : 0))) }]));
  const calib = Object.fromEntries(report.map((n) => [n, { home: calibration(test, n, 'h'), draw: calibration(test, n, 'd'), over: calibration(ouTest, n, 'over') }]));
  // A blend with weight 0 is the market itself: nothing to select.
  const simModels = ['FVIS k=8', best.FVIS, best.DC, ...(blendW > 0 ? ['BLEND'] : [])].filter((v, i, a) => a.indexOf(v) === i);
  const value = Object.fromEntries(simModels.map((n) => [n, { pinTest: valueSim(test, n, 'pin'), maxTest: valueSim(test, n, 'max'), pinTune: valueSim(tune, n, 'pin'), maxTune: valueSim(tune, n, 'max') }]));
  const rhoTest = mean(test.map((r) => r.rho[XI_GRID.indexOf(Number(best.DC.split('=')[1]))]));

  const result = {
    generatedAt: new Date().toISOString(),
    seasons: { first: FIRST, last: LAST, evalFrom: EVAL_FROM, testFrom: TEST_FROM },
    load,
    coverage: { considered, compared: records.length, tune: tune.length, test: test.length, testOu: ouTest.length },
    tuning,
    best,
    bestModel,
    blend: { weight: blendW, grid: blendTune },
    test: testScores,
    tuneScores,
    diffVsPinPre1x2: diffs,
    diffVsPinPreOu: diffsOu,
    byLeague: byLeagueScores,
    bySeason: bySeasonScores,
    draws,
    calibration: calib,
    value,
    rule: RULE,
    meanRhoTest: rhoTest,
    runtimeSeconds: Math.round((Date.now() - started) / 1000),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'backtest-6b.json'), JSON.stringify(result, null, 1));
  const md = summary(result, report, label);
  fs.writeFileSync(path.join(OUT_DIR, 'summary-6b.md'), md);
  process.stdout.write(`${md}\n`);
}

// ---------- report ----------

const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : 'n/a');
const pc = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a');
const spc = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%` : 'n/a');
const ci = ([a, b], fmt) => `[${fmt(a)}, ${fmt(b)}]`;

function summary(r, report, label) {
  const L = [];
  L.push('# FVIS Phase 6b — comparative model backtest', '');
  L.push(`Seasons ${r.seasons.first}/${String(r.seasons.first + 1).slice(2)}–${r.seasons.last}/${String(r.seasons.last + 1).slice(2)} (first season = history only). Tuning: ${r.seasons.evalFrom}–${r.seasons.testFrom - 1}; test (untouched): ${r.seasons.testFrom}–${r.seasons.last}. Prediction cut-off: UTC midnight of the match day.`, '');
  L.push(`Matches considered: ${r.coverage.considered}; compared (every model has output + Pinnacle pre and close 1X2): ${r.coverage.compared} (tuning ${r.coverage.tune}, test ${r.coverage.test}; test O/U 2.5 subset ${r.coverage.testOu}). Runtime ${r.runtimeSeconds} s.`, '');
  const missing = r.load.filter((x) => x.missing);
  if (missing.length) L.push(`Missing files: ${missing.map((x) => `${x.code} ${x.season}`).join(', ')}`, '');

  L.push('## Tuning (log loss 1X2, tuning seasons; lower is better)', '');
  L.push('| Family | Candidate | n | LL 1X2 | LL O/U 2.5 |', '|---|---|---|---|---|');
  for (const [fam, rows] of Object.entries(r.tuning)) for (const t of rows) L.push(`| ${fam} | ${t.name}${t.name === r.best[fam] ? ' ✓' : ''} | ${t.n} | ${f4(t.ll1x2)} | ${f4(t.llOu)} |`);
  L.push('', `Blend weight on ${r.bestModel}: ${r.blend.grid.map((g) => `${g.w} → ${f4(g.ll1x2)}`).join(', ')} (chosen ${r.blend.weight}).`, '');

  L.push('## Test seasons — accuracy', '');
  L.push('| Model | n | LL 1X2 | Brier 1X2 | ΔLL vs PIN_PRE [95% CI] | n O/U | LL O/U 2.5 | Brier O/U | ΔLL O/U vs PIN_PRE [95% CI] |', '|---|---|---|---|---|---|---|---|---|');
  for (const n of report) {
    const s = r.test[n];
    const d = r.diffVsPinPre1x2[n];
    const dOu = r.diffVsPinPreOu[n];
    L.push(`| ${label(n)} | ${s.n} | ${f4(s.ll1x2)} | ${f4(s.brier1x2)} | ${d ? `${f4(d.mean)} ${ci(d.ci, f4)}` : '—'} | ${s.nOu} | ${f4(s.llOu)} | ${f4(s.brierOu)} | ${dOu ? `${f4(dOu.mean)} ${ci(dOu.ci, f4)}` : '—'} |`);
  }
  L.push('', 'ΔLL > 0 means worse than the Pinnacle pre-match market.', '');

  L.push('## Test seasons — log loss 1X2 by league', '');
  L.push(`| League | n | ${report.map(label).join(' | ')} |`, `|---|---|${report.map(() => '---').join('|')}|`);
  for (const [c, s] of Object.entries(r.byLeague)) L.push(`| ${c} | ${s.BASE.n} | ${report.map((n) => f4(s[n].ll1x2)).join(' | ')} |`);
  L.push('', '## Log loss 1X2 by season (all evaluated seasons)', '');
  L.push(`| Season | n | ${report.map(label).join(' | ')} |`, `|---|---|${report.map(() => '---').join('|')}|`);
  for (const [season, s] of Object.entries(r.bySeason)) L.push(`| ${season} | ${s.BASE.n} | ${report.map((n) => f4(s[n].ll1x2)).join(' | ')} |`);

  L.push('', '## Calibration (test)', '');
  L.push('| Model | mean P(draw) | observed draws | ECE home | ECE draw | ECE over 2.5 |', '|---|---|---|---|---|---|');
  for (const n of report) {
    const c = r.calibration[n];
    L.push(`| ${label(n)} | ${pc(r.draws[n].predicted)} | ${pc(r.draws[n].observed)} | ${f4(c.home.ece)} | ${f4(c.draw.ece)} | ${f4(c.over.ece)} |`);
  }
  L.push('', `Mean Dixon-Coles ρ (${r.best.DC}, test): ${f4(r.meanRhoTest)}.`, '');

  L.push('## Paper selections with the FVIS-like rule', '');
  L.push(`Rule: EV ≥ ${r.rule.evMin}, p ≥ ${r.rule.pMin}, odds ${r.rule.oddsMin}–${r.rule.oddsMax}, |p − p_Pinnacle_pre| ≤ ${r.rule.divergenceMax}; markets 1X2 and O/U 2.5; 1 unit each. Price taken: pre-match odds of the book (pin = Pinnacle, max = best price across books); CLV against the same book's closing price; close-EV = de-vigged Pinnacle closing probability × odds taken − 1 (the low-variance estimate of real edge).`, '');
  L.push('| Model | Set | Book | Bets | mean model EV | ROI [95% CI] | mean CLV | beat close | close-EV [95% CI] |', '|---|---|---|---|---|---|---|---|---|');
  for (const [n, v] of Object.entries(r.value)) {
    for (const [key, s] of Object.entries(v)) {
      const set = key.endsWith('Test') ? 'test' : 'tuning';
      const book = key.startsWith('pin') ? 'pin' : 'max';
      L.push(`| ${label(n)} | ${set} | ${book} | ${s.bets} | ${spc(s.meanModelEv)} | ${spc(s.roi)} ${ci(s.roiCI, spc)} | ${spc(s.meanClv)} | ${pc(s.beatClose)} | ${spc(s.closeEv)} ${ci(s.closeEvCI, spc)} |`);
    }
  }
  L.push('');
  return L.join('\n');
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`backtest failed: ${err && err.stack}\n`);
    process.exit(1);
  });
}

module.exports = { fitPoisson, predictPoisson, tau, devig, parseMatches, bootCI };
