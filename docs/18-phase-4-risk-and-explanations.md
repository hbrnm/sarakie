# 18 — Phase 4: Risk Engine and Explanations

Implements [06 — risk policy](06-risk-policy.md) and the Gemini boundary of [02 §6](02-architecture.md). Authorized 2026-10-15 with odds-freshness **option A**: the scanner evaluates odds captured in the same run (≤ 6 h); on-demand analysis (Phase 5) fetches fresh odds for the requested fixture (≤ 2 h).

## Risk engine — `src/domain/risk/`

`evaluateFixture({ fixture, estimate, quotes, fetchedMarkets, mode, now })` classifies all 16 in-scope selections (1X2 ×3, DC ×3, DNB ×2, O/U 1.5/2.5/3.5 ×2, BTTS ×2). Pure and deterministic; stamps `riskVersion`, `riskConfigHash`, `modelVersion` and `modelConfigHash`.

| Step | Result | Reason codes |
|---|---|---|
| Fixture gates | `INSUFFICIENT_DATA` for every selection | model reasons (Phase 3), `FIXTURE_NOT_SCHEDULED`, `KICKOFF_TOO_CLOSE` |
| Selection gates | `INSUFFICIENT_DATA` | `ODDS_NOT_FETCHED` (D-11), `ODDS_MISSING`, `ODDS_INVALID`, `ODDS_STALE` (captured or source timestamp) |
| Price | best odds among quotes within `outlierTol` of the cross-book median implied probability; note `PRICE_OUTLIER_EXCLUDED` | — |
| Market reference | de-vig of the chosen bookmaker's complete set; DC from de-vigged 1X2; DNB conditional on no draw | — |
| EV ≤ 0 | `NO_VALUE` | `EV_NOT_POSITIVE` |
| Qualification gates | `WATCHLIST` if any fails, else `QUALIFIED` | `EV_BELOW_QUALIFY`, `MARKET_INCOMPLETE`, `OVERROUND_ABNORMAL`, `MODEL_MARKET_DIVERGENCE`, `PROB_TOO_LOW`, `ODDS_OUT_OF_RANGE`, `THIN_MARKET` |

All failed gates are listed, not only the first. All thresholds are `PROVISIONAL` (`src/domain/risk/config.js`, D-06).

## Explanations — `src/explain/`

- `buildFacts()` freezes pre-formatted values from the model and the risk engine: highlights (QUALIFIED/WATCHLIST only), expected goals, reasons in Romanian, limitations.
- `renderAnalysis()` always produces the numbers deterministically (template). The LLM can only contribute a short commentary paragraph.
- `createGeminiExplainer()` (`@google/genai`, model ID from `GEMINI_MODEL_ID`, 8 s timeout, temperature 0.2) receives **only the facts JSON** and a strict system instruction.
- `validateCommentary()` rejects: any number not present in the facts, certainty/advice language (Romanian and English list), empty or over-long text.
- Any rejection, error or timeout falls back to the template commentary (ADR-015); without model output Gemini is not called at all.

Residual risk (documented): the validator checks numbers and wording, not the meaning of every sentence. Gemini receives only QUALIFIED/WATCHLIST selections, so it has no other selections to promote.

## Gemini availability in Romania (S-42)

Google's billing FAQ states the Gemini API can be used free of charge in the EEA, UK and Switzerland. Secondary sources state that applications *serving end users* in those regions must use the paid tier; the wording is ambiguous ([forum thread](https://discuss.ai.google.dev/t/free-tier-gemini-api-and-uk-eea-ch-does-you-re-in-the-uk-mean-the-developer-or-the-end-users/188180)). FVIS is private, with the Product Owner as developer and sole user, which matches the permitted case most closely. Status: **UNVERIFIED** against the Additional Terms text. Gemini therefore stays optional; FVIS is complete without it.

## Tests

`test/risk/evaluate.test.js` (12) and `test/explain/explain.test.js` (8): status coverage, D-11 not-fetched markets, NO_VALUE on fairly priced books, QUALIFIED vs WATCHLIST (thin market), multiple reasons, outlier exclusion, freshness per mode, missing/invalid odds, incomplete sets never normalized, fixture gates, DNB push-aware EV, DC from 1X2, determinism, config hash; facts, template, accepted/rejected Gemini output, banned phrases (with false-positive checks), timeouts and errors.

Not yet wired into Telegram: `/analyze` and the scanner digest are Phase 5.
