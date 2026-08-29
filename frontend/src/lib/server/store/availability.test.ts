import { describe, it, expect } from 'vitest';
import { parseStoreHours, getStoreOpenState, storeAcceptsOrders } from './availability';

describe('parseStoreHours', () => {
  it('keeps well-formed entries and drops malformed ones', () => {
    const out = parseStoreHours([
      { day: 1, open: '09:00', close: '17:00' },
      { day: 7, open: '09:00', close: '17:00' }, // bad day
      { day: 2, open: '9:00', close: '17:00' }, // bad time format
      { day: 3, open: '09:00' }, // missing close
      'nonsense',
    ]);
    expect(out).toEqual([{ day: 1, open: '09:00', close: '17:00' }]);
  });

  it('returns [] for non-arrays', () => {
    expect(parseStoreHours(undefined)).toEqual([]);
    expect(parseStoreHours(null)).toEqual([]);
    expect(parseStoreHours({})).toEqual([]);
  });
});

describe('storeAcceptsOrders', () => {
  it('is the inverse of ordersPaused', () => {
    expect(storeAcceptsOrders({ ordersPaused: false })).toBe(true);
    expect(storeAcceptsOrders({ ordersPaused: true })).toBe(false);
  });
});

describe('getStoreOpenState', () => {
  it('is always open when no hours are configured', () => {
    const s = getStoreOpenState({ timezone: 'America/New_York', hours: [] });
    expect(s).toEqual({ hoursConfigured: false, openNow: true, nextOpenLabel: null });
  });

  it('is open inside a window (store timezone)', () => {
    // 2026-08-31 is a Monday. 15:00 UTC == 11:00 America/New_York (EDT).
    const now = new Date('2026-08-31T15:00:00Z');
    const s = getStoreOpenState(
      { timezone: 'America/New_York', hours: [{ day: 1, open: '09:00', close: '17:00' }] },
      now,
    );
    expect(s.openNow).toBe(true);
    expect(s.hoursConfigured).toBe(true);
  });

  it('is closed before opening time and reports "today"', () => {
    // Monday 12:00 UTC == 08:00 ET — an hour before the 09:00 open.
    const now = new Date('2026-08-31T12:00:00Z');
    const s = getStoreOpenState(
      { timezone: 'America/New_York', hours: [{ day: 1, open: '09:00', close: '17:00' }] },
      now,
    );
    expect(s.openNow).toBe(false);
    expect(s.nextOpenLabel).toBe('Opens today at 9 AM');
  });

  it('is closed the night before and reports "tomorrow"', () => {
    // Monday 03:00 UTC == Sunday 23:00 ET — next open is Monday 09:00.
    const now = new Date('2026-08-31T03:00:00Z');
    const s = getStoreOpenState(
      { timezone: 'America/New_York', hours: [{ day: 1, open: '09:00', close: '17:00' }] },
      now,
    );
    expect(s.openNow).toBe(false);
    expect(s.nextOpenLabel).toBe('Opens tomorrow at 9 AM');
  });

  it('rolls the next opening forward to another day', () => {
    // Monday 22:00 UTC == 18:00 ET, after close. Only Wednesday configured.
    const now = new Date('2026-08-31T22:00:00Z');
    const s = getStoreOpenState(
      { timezone: 'America/New_York', hours: [{ day: 3, open: '10:00', close: '14:00' }] },
      now,
    );
    expect(s.openNow).toBe(false);
    expect(s.nextOpenLabel).toBe('Opens Wednesday at 10 AM');
  });

  it('falls back to UTC on an unknown timezone rather than throwing', () => {
    const now = new Date('2026-08-31T12:00:00Z'); // Monday noon UTC
    const s = getStoreOpenState(
      { timezone: 'Not/AZone', hours: [{ day: 1, open: '09:00', close: '17:00' }] },
      now,
    );
    expect(s.openNow).toBe(true);
  });
});
