import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sweepExpiredPlans } from './downgrade';

const updateMany = vi.fn();
const prisma = { store: { updateMany } } as never;

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 0 });
});

describe('sweepExpiredPlans', () => {
  it('retires expired comps and lapsed past_due subscriptions', async () => {
    updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
    const now = new Date('2026-09-01T00:00:00Z');
    const res = await sweepExpiredPlans(prisma, now);
    expect(res).toEqual({ compExpired: 2, subscriptionLapsed: 1 });

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { plan: 'PRO', planSource: 'COMP', planCompExpiresAt: { lt: now } },
      data: { plan: 'FREE', planSource: null, planCompExpiresAt: null },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        plan: 'PRO',
        planSource: 'SUBSCRIPTION',
        subscriptionStatus: 'PAST_DUE',
        subscriptionCurrentPeriodEnd: { lt: now },
      },
      data: { plan: 'FREE', planSource: null, subscriptionStatus: 'CANCELED' },
    });
  });

  it('returns zeroes on a healthy system', async () => {
    const res = await sweepExpiredPlans(prisma);
    expect(res).toEqual({ compExpired: 0, subscriptionLapsed: 0 });
  });
});
