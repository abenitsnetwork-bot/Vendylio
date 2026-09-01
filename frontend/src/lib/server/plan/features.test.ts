import { describe, it, expect } from 'vitest';
import { planFeatures, isPro, normalizePlan } from './features';

describe('plan/features (Phase 1a)', () => {
  it('normalizePlan: only the exact string "PRO" is PRO, everything else FREE', () => {
    expect(normalizePlan('PRO')).toBe('PRO');
    expect(normalizePlan('FREE')).toBe('FREE');
    expect(normalizePlan('pro')).toBe('FREE');
    expect(normalizePlan(null)).toBe('FREE');
    expect(normalizePlan(undefined)).toBe('FREE');
    expect(normalizePlan('')).toBe('FREE');
  });

  it('FREE is the generous-but-limited set', () => {
    const f = planFeatures('FREE');
    expect(f.promoCodes).toBe(false);
    expect(f.customDomain).toBe(false);
    expect(f.teamMembers).toBe(false);
    expect(f.whiteLabel).toBe(false);
    expect(f.heroImageLimit).toBe(1);
    expect(f.aiMonthlyQuota).toBe(5);
    expect(f.bankPayout).toBe(false);
  });

  it('PRO unlocks everything + unlimited AI + 3 hero images', () => {
    const f = planFeatures('PRO');
    expect(f.promoCodes).toBe(true);
    expect(f.advancedAnalytics).toBe(true);
    expect(f.customDomain).toBe(true);
    expect(f.teamMembers).toBe(true);
    expect(f.whiteLabel).toBe(true);
    expect(f.heroImageLimit).toBe(3);
    expect(f.aiMonthlyQuota).toBeNull();
    expect(f.bankPayout).toBe(true);
    expect(f.higherWithdrawalLimits).toBe(true);
  });

  it('an unknown plan string falls back to the FREE feature set', () => {
    expect(planFeatures('LEGACY')).toEqual(planFeatures('FREE'));
    expect(planFeatures(null)).toEqual(planFeatures('FREE'));
  });

  it('isPro reflects the store plan', () => {
    expect(isPro({ plan: 'PRO' })).toBe(true);
    expect(isPro({ plan: 'FREE' })).toBe(false);
    expect(isPro({ plan: null })).toBe(false);
  });
});
