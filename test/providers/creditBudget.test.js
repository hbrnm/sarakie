'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCreditBudget } = require('../../src/providers/oddsApi/creditBudget');

test('defaults: 500/month, reserve 50, on-demand cap 200', async () => {
  const b = createCreditBudget({ now: () => new Date('2026-10-15T00:00:00Z') });
  assert.equal((await b.check('scanner', 450)).allowed, true);
  assert.equal((await b.check('scanner', 451)).reason, 'MONTHLY_BUDGET_RESERVE');
  assert.equal((await b.check('on_demand', 201)).reason, 'ON_DEMAND_CAP');
});

test('usage accumulates per purpose and resets per UTC month', async () => {
  let now = new Date('2026-10-31T23:59:00Z');
  const b = createCreditBudget({ now: () => now });
  await b.record('on_demand', 150);
  assert.equal((await b.check('on_demand', 51)).reason, 'ON_DEMAND_CAP');
  assert.equal((await b.check('scanner', 51)).allowed, true);
  now = new Date('2026-11-01T00:00:00Z');
  assert.equal((await b.check('on_demand', 200)).allowed, true);
});

test('provider-reported remaining credits are respected', async () => {
  const b = createCreditBudget({ now: () => new Date('2026-10-15T00:00:00Z') });
  await b.record('scanner', 2, 60);
  assert.equal((await b.check('scanner', 11)).reason, 'PROVIDER_REMAINING_RESERVE');
  assert.equal((await b.check('scanner', 10)).allowed, true);
});

test('unknown purpose is rejected', async () => {
  const b = createCreditBudget();
  await assert.rejects(b.check('betting', 1));
});
