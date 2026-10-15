'use strict';

/** Romanian labels for selections, statuses and reason codes (D-04). */

function selectionLabel(marketCode, selectionCode, line) {
  switch (marketCode) {
    case '1X2':
      return { HOME: 'Victorie gazde (1)', DRAW: 'Egal (X)', AWAY: 'Victorie oaspeți (2)' }[selectionCode];
    case 'DC':
      return `Șansă dublă ${selectionCode}`;
    case 'DNB':
      return selectionCode === 'HOME' ? 'Fără egal – gazde' : 'Fără egal – oaspeți';
    case 'OU':
      return `${selectionCode === 'OVER' ? 'Peste' : 'Sub'} ${line} goluri`;
    case 'BTTS':
      return selectionCode === 'YES' ? 'Ambele marchează – Da' : 'Ambele marchează – Nu';
    default:
      return `${marketCode} ${selectionCode}`;
  }
}

const STATUS = Object.freeze({
  QUALIFIED: 'ELIGIBIL pentru urmărire (QUALIFIED)',
  WATCHLIST: 'De urmărit (WATCHLIST)',
  NO_VALUE: 'Fără valoare (NO_VALUE)',
  INSUFFICIENT_DATA: 'Date insuficiente (INSUFFICIENT_DATA)',
});

const REASONS = Object.freeze({
  LEAGUE_BASELINE_SAMPLE: 'prea puține meciuri în ligă pentru media de goluri',
  LEAGUE_BASELINE_DEGENERATE: 'media de goluri a ligii nu poate fi calculată',
  TEAM_SAMPLE: 'prea puține meciuri pentru o echipă',
  TEAM_SAMPLE_CURRENT_SEASON: 'prea puține meciuri în sezonul curent',
  PROMOTED_TEAM_NO_HISTORY: 'echipă promovată fără istoric suficient',
  LAMBDA_OUT_OF_RANGE: 'golurile așteptate sunt în afara intervalului plauzibil',
  MODEL_NOT_APPLICABLE_CROSS_LEAGUE: 'modelul nu se aplică meciurilor între ligi diferite',
  FIXTURE_NOT_SCHEDULED: 'meciul nu mai este programat',
  KICKOFF_TOO_CLOSE: 'prea aproape de începerea meciului',
  ODDS_NOT_FETCHED: 'cotele pentru această piață nu au fost descărcate',
  ODDS_MISSING: 'nu există cote pentru această selecție',
  ODDS_INVALID: 'cote invalide',
  ODDS_STALE: 'cote prea vechi',
  EV_NOT_POSITIVE: 'valoare așteptată nepozitivă',
  EV_BELOW_QUALIFY: 'valoare așteptată sub pragul de calificare',
  MARKET_INCOMPLETE: 'set de cote incomplet la casa aleasă',
  OVERROUND_ABNORMAL: 'marjă a casei anormală',
  MODEL_MARKET_DIVERGENCE: 'diferență prea mare între model și piață',
  PROB_TOO_LOW: 'probabilitate prea mică',
  ODDS_OUT_OF_RANGE: 'cotă în afara intervalului acceptat',
  THIN_MARKET: 'prea puține case de pariuri',
  TEAM_SAMPLE_SMALL: 'istoric scurt pentru o echipă (sub 10 meciuri, de ex. promovată)',
  QUALIFIED_SUSPENDED: 'QUALIFIED suspendat: backtestul nu arată valoare reală a modelului',
});

const reasonText = (code) => REASONS[code] || code;

module.exports = { selectionLabel, STATUS, REASONS, reasonText };
