// Phase 8 — "today" / "this month" boundaries in the STORE's timezone, as
// absolute UTC instants suitable for a Prisma `paidAt: { gte: … }` filter.
//
// Before Phase 8 the dashboard used UTC midnight, which rolls the day over at
// 7–8 PM for a US merchant (§9). Now that Store.timezone exists we anchor the
// window to the business's own clock.
import 'server-only';

/** Offset (ms) to add to a UTC instant to get the given tz's wall clock.
 * The classic Intl round-trip; good to the minute, which is all a day
 * boundary needs. Unknown tz → 0 (UTC). */
function zoneOffsetMs(now: Date, tz: string): number {
  try {
    const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    return local.getTime() - utc.getTime();
  } catch {
    return 0;
  }
}

function ymdInZone(now: Date, tz: string): { y: number; m: number; d: number } {
  let s: string;
  try {
    s = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now); // "2026-08-30"
  } catch {
    s = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
  const [y, m, d] = s.split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

/** UTC instant of the most recent local-midnight in `tz`. */
export function startOfStoreDay(tz: string, now: Date = new Date()): Date {
  const { y, m, d } = ymdInZone(now, tz);
  const localMidnightAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(localMidnightAsUtc - zoneOffsetMs(now, tz));
}

/** UTC instant of local midnight on the 1st of the current month in `tz`. */
export function startOfStoreMonth(tz: string, now: Date = new Date()): Date {
  const { y, m } = ymdInZone(now, tz);
  const localMonthStartAsUtc = Date.UTC(y, m - 1, 1, 0, 0, 0);
  return new Date(localMonthStartAsUtc - zoneOffsetMs(now, tz));
}
