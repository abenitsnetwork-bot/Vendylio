import { describe, it, expect } from 'vitest';
import { discountStatus } from './discountStatus';

const base = {
  active: true,
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  redemptionCount: 0,
};
const now = new Date('2026-09-01T12:00:00Z');

describe('discountStatus', () => {
  it('ACTIVE with no bounds and no cap', () => {
    expect(discountStatus(base, now)).toBe('ACTIVE');
  });

  it('OFF when active is false (takes precedence over everything)', () => {
    expect(discountStatus({ ...base, active: false }, now)).toBe('OFF');
  });

  it('EXHAUSTED when redemptionCount has reached maxRedemptions', () => {
    expect(discountStatus({ ...base, maxRedemptions: 5, redemptionCount: 5 }, now)).toBe(
      'EXHAUSTED',
    );
    expect(discountStatus({ ...base, maxRedemptions: 5, redemptionCount: 4 }, now)).toBe('ACTIVE');
  });

  it('SCHEDULED before startsAt, ACTIVE once reached', () => {
    expect(discountStatus({ ...base, startsAt: '2026-09-02T00:00:00Z' }, now)).toBe('SCHEDULED');
    expect(discountStatus({ ...base, startsAt: '2026-08-31T00:00:00Z' }, now)).toBe('ACTIVE');
  });

  it('EXPIRED after endsAt', () => {
    expect(discountStatus({ ...base, endsAt: '2026-08-31T23:59:00Z' }, now)).toBe('EXPIRED');
    expect(discountStatus({ ...base, endsAt: '2026-09-02T00:00:00Z' }, now)).toBe('ACTIVE');
  });

  it('OFF beats an otherwise-in-window code', () => {
    expect(
      discountStatus(
        {
          ...base,
          active: false,
          startsAt: '2026-08-01T00:00:00Z',
          endsAt: '2026-10-01T00:00:00Z',
        },
        now,
      ),
    ).toBe('OFF');
  });
});
