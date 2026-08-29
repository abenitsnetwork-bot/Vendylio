import { describe, it, expect } from 'vitest';
import { mapOrderStatusForCustomer, buildOrderTimeline, isClosedStatus } from './customerView';

describe('mapOrderStatusForCustomer', () => {
  it('translates internal states to customer language, never leaking the raw state', () => {
    expect(mapOrderStatusForCustomer('PREPARING', 'DELIVERY').label).toBe('Being prepared');
    expect(mapOrderStatusForCustomer('OUT_FOR_DELIVERY', 'DELIVERY').label).toBe('On the way');
    expect(mapOrderStatusForCustomer('OUT_FOR_DELIVERY', 'DELIVERY').key).toBe('ON_THE_WAY');
    expect(mapOrderStatusForCustomer('PAID', 'DELIVERY').label).toBe('Order confirmed');
  });

  it('uses pickup wording for the pickup flow', () => {
    expect(mapOrderStatusForCustomer('READY', 'PICKUP').label).toBe('Ready for pickup');
    expect(mapOrderStatusForCustomer('DELIVERED', 'PICKUP').label).toBe('Picked up');
    expect(mapOrderStatusForCustomer('DELIVERED', 'DELIVERY').label).toBe('Delivered');
  });

  it('reassures on payment-not-completed states without alarming language', () => {
    expect(mapOrderStatusForCustomer('FAILED', 'DELIVERY').description).toContain('not charged');
    expect(mapOrderStatusForCustomer('EXPIRED', 'DELIVERY').description).toContain('not charged');
  });
});

describe('isClosedStatus', () => {
  it('flags the terminal-bad states', () => {
    expect(isClosedStatus('CANCELLED')).toBe(true);
    expect(isClosedStatus('REFUNDED')).toBe(true);
    expect(isClosedStatus('EXPIRED')).toBe(true);
    expect(isClosedStatus('FAILED')).toBe(true);
    expect(isClosedStatus('PREPARING')).toBe(false);
    expect(isClosedStatus('DELIVERED')).toBe(false);
  });
});

describe('buildOrderTimeline', () => {
  const t = (s: string, iso: string) => ({ status: s, createdAt: iso });

  it('marks reached steps done, the next one current, the rest upcoming', () => {
    const steps = buildOrderTimeline(
      [t('PAID', '2026-08-01T10:00:00Z'), t('PREPARING', '2026-08-01T10:10:00Z')],
      'DELIVERY',
    );
    expect(steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      'CONFIRMED:done',
      'PREPARING:done',
      'READY:current',
      'ON_THE_WAY:upcoming',
      'DELIVERED:upcoming',
    ]);
    expect(steps[0]?.at).toBe('2026-08-01T10:00:00.000Z');
  });

  it('drops the ON_THE_WAY step for a pickup order', () => {
    const steps = buildOrderTimeline([t('PAID', '2026-08-01T10:00:00Z')], 'PICKUP');
    expect(steps.map((s) => s.key)).toEqual(['CONFIRMED', 'PREPARING', 'READY', 'DELIVERED']);
    expect(steps[3]?.label).toBe('Picked up');
  });

  it('never regresses when a stale event arrives after a later one (§152/§223)', () => {
    const steps = buildOrderTimeline(
      [
        t('PAID', '2026-08-01T10:00:00Z'),
        t('PREPARING', '2026-08-01T10:05:00Z'),
        t('READY', '2026-08-01T10:20:00Z'),
        t('OUT_FOR_DELIVERY', '2026-08-01T10:30:00Z'),
        t('DELIVERED', '2026-08-01T11:00:00Z'),
        // stale duplicate lands last
        t('PREPARING', '2026-08-01T11:05:00Z'),
      ],
      'DELIVERY',
    );
    expect(steps.every((s) => s.state === 'done')).toBe(true);
  });

  it('collapses duplicate events for one step to the earliest timestamp (§222)', () => {
    const steps = buildOrderTimeline(
      [
        t('PAID', '2026-08-01T10:00:00Z'),
        t('PREPARING', '2026-08-01T10:10:00Z'),
        t('PREPARING', '2026-08-01T10:12:00Z'),
      ],
      'DELIVERY',
    );
    expect(steps[1]?.at).toBe('2026-08-01T10:10:00.000Z');
  });

  it('ignores non-timeline events (CANCELLED / stray)', () => {
    const steps = buildOrderTimeline(
      [t('PAID', '2026-08-01T10:00:00Z'), t('CANCELLED', '2026-08-01T10:30:00Z')],
      'DELIVERY',
    );
    expect(steps[0]?.state).toBe('done');
    expect(steps[1]?.state).toBe('current');
  });
});
