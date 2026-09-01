import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  syncSubscriptionFromStripe,
  markSubscriptionPastDue,
  type SubscriptionInput,
} from './sync-subscription';

const findUnique = vi.fn();
const update = vi.fn();
const tx = { store: { findUnique, update } } as never;

function lastData(): Record<string, unknown> {
  const call = update.mock.calls.at(-1);
  if (!call) throw new Error('store.update was not called');
  return (call[0] as { data: Record<string, unknown> }).data;
}

const base: SubscriptionInput = {
  id: 'sub_1',
  customerId: 'cus_1',
  status: 'active',
  currentPeriodEnd: 1_900_000_000,
  storeId: 'store-1',
};

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
});

describe('syncSubscriptionFromStripe', () => {
  it('active → plan PRO, planSource SUBSCRIPTION, records period end', async () => {
    findUnique.mockResolvedValueOnce({ id: 'store-1', plan: 'FREE', planSource: null });
    const res = await syncSubscriptionFromStripe(tx, base);
    expect(res).toEqual({ storeId: 'store-1', plan: 'PRO' });
    const data = lastData();
    expect(data.plan).toBe('PRO');
    expect(data.planSource).toBe('SUBSCRIPTION');
    expect(data.subscriptionStatus).toBe('ACTIVE');
    expect(data.subscriptionCurrentPeriodEnd).toEqual(new Date(1_900_000_000 * 1000));
    expect(data.stripeSubscriptionId).toBe('sub_1');
  });

  it('trialing counts as active', async () => {
    findUnique.mockResolvedValueOnce({ id: 'store-1', plan: 'FREE', planSource: null });
    await syncSubscriptionFromStripe(tx, { ...base, status: 'trialing' });
    const data = lastData();
    expect(data.plan).toBe('PRO');
    expect(data.subscriptionStatus).toBe('TRIALING');
  });

  it('past_due records status only — never touches plan/planSource', async () => {
    findUnique.mockResolvedValueOnce({ id: 'store-1', plan: 'PRO', planSource: 'SUBSCRIPTION' });
    await syncSubscriptionFromStripe(tx, { ...base, status: 'past_due' });
    const data = lastData();
    expect(data.subscriptionStatus).toBe('PAST_DUE');
    expect(data.plan).toBeUndefined();
    expect(data.planSource).toBeUndefined();
  });

  it('canceled → plan FREE only when planSource was SUBSCRIPTION', async () => {
    findUnique.mockResolvedValueOnce({ id: 'store-1', plan: 'PRO', planSource: 'SUBSCRIPTION' });
    await syncSubscriptionFromStripe(tx, { ...base, status: 'canceled' });
    const data = lastData();
    expect(data.plan).toBe('FREE');
    expect(data.planSource).toBeNull();
  });

  it('canceled on a COMP store does NOT downgrade (comp is independent of Stripe)', async () => {
    findUnique.mockResolvedValueOnce({ id: 'store-1', plan: 'PRO', planSource: 'COMP' });
    await syncSubscriptionFromStripe(tx, { ...base, status: 'canceled' });
    const data = lastData();
    expect(data.plan).toBeUndefined();
    expect(data.planSource).toBeUndefined();
  });

  it('falls back to stripeSubscriptionId then stripeCustomerId when metadata storeId is absent', async () => {
    findUnique
      .mockResolvedValueOnce(null) // by subscription id
      .mockResolvedValueOnce({ id: 'store-9', plan: 'FREE', planSource: null }); // by customer id
    const res = await syncSubscriptionFromStripe(tx, { ...base, storeId: null });
    expect(res?.storeId).toBe('store-9');
  });

  it('returns null when no store matches', async () => {
    findUnique.mockResolvedValue(null);
    const res = await syncSubscriptionFromStripe(tx, { ...base, storeId: null });
    expect(res).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('null currentPeriodEnd is stored as null', async () => {
    findUnique.mockResolvedValueOnce({ id: 'store-1', plan: 'FREE', planSource: null });
    await syncSubscriptionFromStripe(tx, { ...base, currentPeriodEnd: null });
    expect(lastData().subscriptionCurrentPeriodEnd).toBeNull();
  });

  it('Phase 5 — writes subscriptionInterval from the input', async () => {
    findUnique.mockResolvedValueOnce({ id: 'store-1', plan: 'FREE', planSource: null });
    await syncSubscriptionFromStripe(tx, { ...base, interval: 'year' });
    expect(lastData().subscriptionInterval).toBe('year');
  });

  it('Phase 5 — ignores an unknown interval', async () => {
    findUnique.mockResolvedValueOnce({ id: 'store-1', plan: 'FREE', planSource: null });
    await syncSubscriptionFromStripe(tx, { ...base, interval: 'weekly' });
    expect(lastData().subscriptionInterval).toBeUndefined();
  });
});

describe('markSubscriptionPastDue', () => {
  it('sets PAST_DUE for a subscription-backed store', async () => {
    findUnique.mockResolvedValueOnce({ id: 'store-1', planSource: 'SUBSCRIPTION' });
    await markSubscriptionPastDue(tx, 'cus_1');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { subscriptionStatus: 'PAST_DUE' },
    });
  });

  it('is a no-op for a COMP store or unknown customer', async () => {
    findUnique.mockResolvedValueOnce({ id: 'store-1', planSource: 'COMP' });
    await markSubscriptionPastDue(tx, 'cus_1');
    findUnique.mockResolvedValueOnce(null);
    await markSubscriptionPastDue(tx, 'cus_x');
    expect(update).not.toHaveBeenCalled();
  });
});
