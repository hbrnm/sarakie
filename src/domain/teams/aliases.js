'use strict';

/**
 * Curated alias groups for team names that automatic matching cannot resolve
 * (abbreviations, nicknames, different official names). Each inner array lists names
 * of ONE club across sources. Matching is per competition, so groups never cross leagues.
 *
 * Status: starter list from known naming conventions of football-data.org, The Odds API
 * and football-data.co.uk. It is verified and extended from the live mapping report
 * (`scripts/adapter-smoke.js`); unmatched names are never guessed.
 */
module.exports = Object.freeze([
  // England
  ['Manchester United', 'Man United', 'Man Utd', 'Manchester Utd'],
  ['Manchester City', 'Man City'],
  ['Tottenham Hotspur', 'Tottenham', 'Spurs'],
  ['Wolverhampton Wanderers', 'Wolves', 'Wolverhampton'],
  ["Nottingham Forest", "Nott'm Forest", 'Nottm Forest'],
  ['Sheffield United', 'Sheffield Utd'],
  ['Sheffield Wednesday', 'Sheffield Weds'],
  ['West Bromwich Albion', 'West Brom'],
  ['Queens Park Rangers', 'QPR'],
  // Spain
  ['Atletico Madrid', 'Ath Madrid', 'Club Atletico de Madrid', 'Atletico de Madrid'],
  ['Athletic Bilbao', 'Ath Bilbao', 'Athletic Club'],
  ['Real Betis', 'Betis', 'Real Betis Balompie'],
  ['Real Sociedad', 'Sociedad', 'Real Sociedad de Futbol'],
  ['Celta Vigo', 'Celta', 'RC Celta de Vigo', 'Celta de Vigo'],
  ['Rayo Vallecano', 'Vallecano', 'Rayo Vallecano de Madrid'],
  ['Espanyol', 'Espanol', 'RCD Espanyol de Barcelona'],
  ['Alaves', 'Deportivo Alaves'],
  ['Deportivo La Coruna', 'La Coruna', 'RC Deportivo La Coruna'],
  // Italy
  ['Inter', 'Inter Milan', 'FC Internazionale Milano', 'Internazionale'],
  ['AC Milan', 'Milan'],
  // Germany
  ['Bayern Munich', 'Bayern Munchen', 'FC Bayern Munchen', 'Bayern'],
  ['Borussia Monchengladbach', "M'gladbach", 'Gladbach', 'Monchengladbach'],
  ['Eintracht Frankfurt', 'Ein Frankfurt'],
  ['Bayer Leverkusen', 'Leverkusen', 'Bayer 04 Leverkusen'],
  ['1. FC Koln', 'FC Koln', 'Koln', 'Cologne', '1. FC Köln'],
  ['RB Leipzig', 'RasenBallsport Leipzig', 'Leipzig'],
  ['Hamburger SV', 'Hamburg'],
  ['Hertha Berlin', 'Hertha', 'Hertha BSC'],
  ['FC St. Pauli', 'St Pauli'],
  // France
  ['Paris Saint-Germain', 'Paris SG', 'PSG', 'Paris Saint Germain'],
  ['Saint-Etienne', 'St Etienne', 'AS Saint-Etienne'],
  ['Olympique Lyonnais', 'Lyon'],
  ['Olympique de Marseille', 'Marseille'],
  ['Stade Rennais', 'Rennes', 'Stade Rennais FC 1901'],
  ['Stade Brestois 29', 'Brest'],
  ['Lille', 'Lille OSC', 'LOSC Lille'],
  ['Racing Club de Lens', 'Lens', 'RC Lens'],
  ['RC Strasbourg Alsace', 'Strasbourg'],
  // UEFA competitions (names seen in the live smoke test, 2026-10-15)
  ['AEK Athens', 'AEK Athina', 'AEK Athina FC'],
  ['Sporting Lisbon', 'Sporting CP', 'Sporting Clube de Portugal'],
]);
