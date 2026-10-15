'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, parseSeasonCsv, parseKickoff, seasonCode, createFootballDataCoUkAdapter } = require('../../src/providers/footballDataCoUk');
const { createHttpClient } = require('../../src/providers/http');
const { createFakeFetch } = require('./fakes');

const CSV =
  '﻿Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,B365CH,B365CD,B365CA,AvgCH,AvgCD,AvgCA,AvgC>2.5,AvgC<2.5\r\n' +
  'E0,15/08/2026,20:00,Arsenal,Coventry,2,0,1.3,5.5,10,1.31,5.4,9.5,1.6,2.4\r\n' +
  'E0,05/01/2027,15:00,"Nott\'m Forest",Man United,1,1,3.1,3.3,2.4,,,,1.9,1.95\r\n' +
  'E0,06/01/2027,15:00,Hull,Everton,,,2.5,3.2,2.9,,,,,\r\n' +
  ',,,,,,,,,,,,,,\r\n';

test('season code', () => {
  assert.equal(seasonCode(2026), '2627');
  assert.equal(seasonCode(1999), '9900');
});

test('CSV parser handles BOM, quotes, escaped quotes and CRLF', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
});

test('UK local kickoff times are converted to UTC across BST/GMT', () => {
  assert.equal(parseKickoff('15/08/2026', '20:00'), '2026-08-15T19:00:00.000Z'); // BST
  assert.equal(parseKickoff('05/01/2027', '15:00'), '2027-01-05T15:00:00.000Z'); // GMT
  assert.equal(parseKickoff('15/08/26', ''), '2026-08-15T11:00:00.000Z');
  assert.equal(parseKickoff('2026-08-15', '20:00'), null);
});

test('season CSV → finished fixtures + complete closing-odds sets only', () => {
  const r = parseSeasonCsv(CSV, { competitionCode: 'EPL', season: 2026, capturedAt: '2026-10-15T00:00:00.000Z' });
  assert.equal(r.fixtures.length, 2);
  assert.deepEqual(r.report.dropped, { SCORE_MISSING: 1 });
  assert.equal(r.fixtures[1].home.name, "Nott'm Forest");
  assert.equal(r.fixtures[0].homeGoals, 2);
  const keys = r.closingQuotes.map((q) => `${q.providerEventId.split(':').slice(-2).join('-')}|${q.bookmakerKey}|${q.marketCode}:${q.selectionCode}`);
  assert.deepEqual(keys, [
    'Arsenal-Coventry|bet365|1X2:HOME', 'Arsenal-Coventry|bet365|1X2:DRAW', 'Arsenal-Coventry|bet365|1X2:AWAY',
    'Arsenal-Coventry|market_average|1X2:HOME', 'Arsenal-Coventry|market_average|1X2:DRAW', 'Arsenal-Coventry|market_average|1X2:AWAY',
    'Arsenal-Coventry|market_average|OU:OVER', 'Arsenal-Coventry|market_average|OU:UNDER',
    "Nott'm Forest-Man United|bet365|1X2:HOME", "Nott'm Forest-Man United|bet365|1X2:DRAW", "Nott'm Forest-Man United|bet365|1X2:AWAY",
    "Nott'm Forest-Man United|market_average|OU:OVER", "Nott'm Forest-Man United|market_average|OU:UNDER",
  ]);
  assert.ok(r.closingQuotes.every((q) => q.kind === 'closing'));
});

test('adapter fetches the right file and refuses UEFA competitions', async () => {
  const fake = createFakeFetch({ '/mmz4281/2627/E0.csv': { body: CSV } });
  const http = createHttpClient({ provider: 'x', fetchImpl: fake.fetchImpl });
  const a = createFootballDataCoUkAdapter({ http });
  const r = await a.getSeason({ competitionCode: 'EPL', season: 2026 });
  assert.equal(r.fixtures.length, 2);
  assert.equal(a.supports('UCL'), false);
  await assert.rejects(a.getSeason({ competitionCode: 'UCL', season: 2026 }), (e) => e.code === 'NO_PROVIDER_COVERAGE');
});
