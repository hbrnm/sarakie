'use strict';

/**
 * Monthly credit budget guard for The Odds API (free plan: 500 credits/month, D-11).
 * Every odds request is checked before it is sent and recorded afterwards.
 *
 * Purposes: 'scanner' (daily 1X2 + main O/U), 'on_demand' (extra markets, capped), 'other'.
 */

const DEFAULTS = Object.freeze({ monthlyLimit: 500, reserve: 50, onDemandMonthlyCap: 200 });

function monthKey(date) {
  return date.toISOString().slice(0, 7);
}

/** In-memory store; replaced by a Supabase-backed store in Phase 2.2. */
function createMemoryCreditStore() {
  const months = new Map();
  return {
    async get(month) {
      return months.get(month) || { scanner: 0, on_demand: 0, other: 0, providerRemaining: null };
    },
    async add(month, purpose, credits, providerRemaining) {
      const cur = { ...(await this.get(month)) };
      cur[purpose] += credits;
      if (providerRemaining !== null && providerRemaining !== undefined) cur.providerRemaining = providerRemaining;
      months.set(month, cur);
    },
  };
}

/**
 * @param {{
 *   store?: ReturnType<typeof createMemoryCreditStore>,
 *   monthlyLimit?: number, reserve?: number, onDemandMonthlyCap?: number,
 *   now?: () => Date,
 * }} [options]
 */
function createCreditBudget(options = {}) {
  const { store = createMemoryCreditStore(), now = () => new Date() } = options;
  const monthlyLimit = options.monthlyLimit ?? DEFAULTS.monthlyLimit;
  const reserve = options.reserve ?? DEFAULTS.reserve;
  const onDemandMonthlyCap = options.onDemandMonthlyCap ?? DEFAULTS.onDemandMonthlyCap;
  const PURPOSES = ['scanner', 'on_demand', 'other'];

  function assertPurpose(purpose) {
    if (!PURPOSES.includes(purpose)) throw new Error(`unknown credit purpose: ${purpose}`);
  }

  return {
    /** @returns {Promise<{ allowed: boolean, reason: string | null, usedThisMonth: number }>} */
    async check(purpose, estimatedCredits) {
      assertPurpose(purpose);
      const s = await store.get(monthKey(now()));
      const used = s.scanner + s.on_demand + s.other;
      if (used + estimatedCredits > monthlyLimit - reserve) {
        return { allowed: false, reason: 'MONTHLY_BUDGET_RESERVE', usedThisMonth: used };
      }
      if (s.providerRemaining !== null && s.providerRemaining - estimatedCredits < reserve) {
        return { allowed: false, reason: 'PROVIDER_REMAINING_RESERVE', usedThisMonth: used };
      }
      if (purpose === 'on_demand' && s.on_demand + estimatedCredits > onDemandMonthlyCap) {
        return { allowed: false, reason: 'ON_DEMAND_CAP', usedThisMonth: used };
      }
      return { allowed: true, reason: null, usedThisMonth: used };
    },
    async record(purpose, credits, providerRemaining = null) {
      assertPurpose(purpose);
      await store.add(monthKey(now()), purpose, Math.max(0, credits), providerRemaining);
    },
    async usage() {
      const s = await store.get(monthKey(now()));
      return { month: monthKey(now()), ...s, used: s.scanner + s.on_demand + s.other, monthlyLimit, reserve, onDemandMonthlyCap };
    },
  };
}

module.exports = { createCreditBudget, createMemoryCreditStore, DEFAULTS };
