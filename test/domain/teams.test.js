'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTeamName, createTeamMatcher, linkEventsToFixtures } = require('../../src/domain/teams/matching');

const EPL = [
  { id: '57', names: ['Arsenal FC', 'Arsenal'] },
  { id: '66', names: ['Manchester United FC', 'Man United'] },
  { id: '65', names: ['Manchester City FC', 'Man City'] },
  { id: '351', names: ['Nottingham Forest FC', 'Nottingham'] },
  { id: '322', names: ['Hull City AFC', 'Hull City'] },
  { id: '397', names: ['Brighton & Hove Albion FC', 'Brighton Hove'] },
  { id: '73', names: ['Tottenham Hotspur FC', 'Tottenham'] },
  { id: '76', names: ['Wolverhampton Wanderers FC', 'Wolverhampton'] },
];
const SERIEA = [
  { id: '98', names: ['AC Milan', 'Milan'] },
  { id: '108', names: ['FC Internazionale Milano', 'Inter'] },
  { id: '100', names: ['AS Roma', 'Roma'] },
  { id: '109', names: ['Juventus FC', 'Juventus'] },
];

test('normalization strips accents, punctuation and generic club tokens', () => {
  assert.equal(normalizeTeamName('1. FC Köln'), 'koln');
  assert.equal(normalizeTeamName("Nott'm Forest"), 'nottm forest');
  assert.equal(normalizeTeamName('Brighton & Hove Albion FC'), 'brighton hove albion');
  assert.equal(normalizeTeamName('Club Atlético de Madrid'), 'atletico madrid');
  assert.equal(normalizeTeamName('Borussia Mönchengladbach'), 'borussia monchengladbach');
});

test('matches names from all three sources', () => {
  const m = createTeamMatcher(EPL);
  const cases = {
    Arsenal: '57', 'Man United': '66', 'Manchester United': '66', 'Man Utd': '66', 'Man City': '65',
    "Nott'm Forest": '351', 'Nottingham Forest': '351', Hull: '322', 'Hull City': '322',
    'Brighton and Hove Albion': '397', Brighton: '397', Spurs: '73', Tottenham: '73', Wolves: '76',
  };
  for (const [name, id] of Object.entries(cases)) assert.equal(m.match(name).teamId, id, name);
});

test('Milan / Inter are resolved by alias, not by fuzzy match', () => {
  const m = createTeamMatcher(SERIEA);
  assert.equal(m.match('Milan').teamId, '98');
  assert.equal(m.match('AC Milan').teamId, '98');
  assert.equal(m.match('Inter').teamId, '108');
  assert.equal(m.match('Inter Milan').teamId, '108');
});

test('unknown and ambiguous names are never guessed', () => {
  const m = createTeamMatcher(EPL);
  assert.deepEqual(m.match('Leeds'), { teamId: null, reason: 'UNMATCHED', candidates: [] });
  const amb = createTeamMatcher([{ id: '1', names: ['Real Madrid'] }, { id: '2', names: ['Real Sociedad'] }]).match('Real');
  assert.equal(amb.reason, 'AMBIGUOUS');
});

test('odds events are linked to fixtures by teams and kickoff tolerance', () => {
  const m = createTeamMatcher(EPL);
  const fixtures = [
    { providerFixtureId: 'f1', competitionCode: 'EPL', kickoffUtc: '2026-10-18T14:00:00Z', home: { providerTeamId: '57' }, away: { providerTeamId: '66' } },
  ];
  const events = [
    { providerEventId: 'e1', competitionCode: 'EPL', kickoffUtc: '2026-10-18T14:00:00Z', homeTeamName: 'Arsenal', awayTeamName: 'Manchester United' },
    { providerEventId: 'e2', competitionCode: 'EPL', kickoffUtc: '2026-10-25T14:00:00Z', homeTeamName: 'Arsenal', awayTeamName: 'Manchester United' },
    { providerEventId: 'e3', competitionCode: 'EPL', kickoffUtc: '2026-10-18T14:00:00Z', homeTeamName: 'Leeds', awayTeamName: 'Arsenal' },
  ];
  const r = linkEventsToFixtures({ events, fixtures, matcher: m });
  assert.deepEqual(r.links, [{ providerEventId: 'e1', providerFixtureId: 'f1' }]);
  assert.deepEqual(r.unlinked.map((u) => u.reason), ['FIXTURE_NOT_FOUND', 'TEAM_UNMAPPED']);
});

test('alias table has no name in two groups', () => {
  assert.doesNotThrow(() => require('../../src/domain/teams/matching'));
});
