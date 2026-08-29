import { describe, it, expect } from 'vitest';
import { startOfStoreDay, startOfStoreMonth } from './timezoneWindow';

describe('startOfStoreDay', () => {
  it('anchors to local midnight in the store timezone, not UTC', () => {
    // 2026-08-31T02:00:00Z is still Aug 30 (22:00) in New York.
    const now = new Date('2026-08-31T02:00:00Z');
    const start = startOfStoreDay('America/New_York', now);
    // Local midnight Aug 30 EDT = 04:00Z Aug 30.
    expect(start.toISOString()).toBe('2026-08-30T04:00:00.000Z');
    expect(start.getTime()).toBeLessThan(now.getTime());
  });

  it('matches UTC midnight when the timezone is UTC', () => {
    const now = new Date('2026-08-31T13:45:00Z');
    expect(startOfStoreDay('UTC', now).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('falls back gracefully on an unknown timezone', () => {
    const now = new Date('2026-08-31T13:45:00Z');
    expect(startOfStoreDay('Bogus/Zone', now).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
});

describe('startOfStoreMonth', () => {
  it('anchors to the 1st at local midnight in the store timezone', () => {
    const now = new Date('2026-08-31T02:00:00Z'); // Aug 30 22:00 ET
    const start = startOfStoreMonth('America/New_York', now);
    expect(start.toISOString()).toBe('2026-08-01T04:00:00.000Z');
  });
});
