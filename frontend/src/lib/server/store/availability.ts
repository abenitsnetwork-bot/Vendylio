// Phase 8 — store operating state.
//
// Two independent concepts:
//   - ordersPaused: a HARD switch. When true, checkout rejects new orders
//     (STORE_NOT_ACCEPTING_ORDERS) regardless of hours or `published`.
//   - hours: SOFT / informational. Drives the storefront "currently closed"
//     banner and the dashboard "opens at …" text. Checkout is NOT gated on
//     hours (a store may legitimately take orders for later).
//
// Timezone handling uses Intl (full ICU ships with Node ≥ 20) — no dependency.
import 'server-only';

export interface StoreHoursEntry {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  /** "HH:MM" 24h, store-local. */
  open: string;
  /** "HH:MM" 24h, store-local. `close` <= `open` is treated as a same-day
   * range that never opens (we don't model overnight ranges in V1). */
  close: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Validate + normalize a raw hours array from the client/DB. Drops malformed
 * entries rather than throwing (a bad row shouldn't 500 the storefront). */
export function parseStoreHours(raw: unknown): StoreHoursEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: StoreHoursEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { day, open, close } = item as Record<string, unknown>;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) continue;
    if (typeof open !== 'string' || typeof close !== 'string') continue;
    if (!HHMM.test(open) || !HHMM.test(close)) continue;
    out.push({ day, open, close });
  }
  return out;
}

/** The store's wall-clock now, in its own timezone. */
function nowInZone(tz: string, now: Date): { dow: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  } catch {
    // Unknown timezone string — fall back to UTC rather than crash.
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  }
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '0';
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // Intl can emit "24" for midnight in some environments — clamp to 0.
  const hour = Number(hourRaw) % 24;
  return { dow: DOW[wd] ?? 0, minutes: hour * 60 + Number(minute) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

function fmtTime(hhmm: string): string {
  const mins = toMinutes(hhmm);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

const WEEKDAY_LABEL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export interface StoreOpenState {
  /** No hours configured at all — we never claim "closed" in that case. */
  hoursConfigured: boolean;
  openNow: boolean;
  /** e.g. "Opens today at 9 AM", "Opens Monday at 9 AM" — only when closed. */
  nextOpenLabel: string | null;
}

/**
 * Is the store within its opening hours right now (in its own timezone)?
 * `hours` empty → always "open" (informational only anyway).
 */
export function getStoreOpenState(
  input: { timezone: string; hours: unknown },
  now: Date = new Date(),
): StoreOpenState {
  const hours = parseStoreHours(input.hours);
  if (hours.length === 0) {
    return { hoursConfigured: false, openNow: true, nextOpenLabel: null };
  }

  const { dow, minutes } = nowInZone(input.timezone || 'UTC', now);

  const openToday = hours.some((h) => {
    if (h.day !== dow) return false;
    const o = toMinutes(h.open);
    const c = toMinutes(h.close);
    return c > o && minutes >= o && minutes < c;
  });
  if (openToday) return { hoursConfigured: true, openNow: true, nextOpenLabel: null };

  // Find the next opening: later today, then each of the next 6 days.
  for (let ahead = 0; ahead < 7; ahead++) {
    const checkDay = (dow + ahead) % 7;
    const slots = hours
      .filter((h) => h.day === checkDay && toMinutes(h.close) > toMinutes(h.open))
      .map((h) => h.open)
      .sort();
    for (const open of slots) {
      if (ahead === 0 && toMinutes(open) <= minutes) continue;
      const when = ahead === 0 ? 'today' : ahead === 1 ? 'tomorrow' : WEEKDAY_LABEL[checkDay];
      return {
        hoursConfigured: true,
        openNow: false,
        nextOpenLabel: `Opens ${when} at ${fmtTime(open)}`,
      };
    }
  }

  return { hoursConfigured: true, openNow: false, nextOpenLabel: null };
}

/** The single question checkout asks. Hours are soft; only the pause switch
 * (and store existence/publish, checked separately) blocks an order. */
export function storeAcceptsOrders(store: { ordersPaused: boolean }): boolean {
  return !store.ordersPaused;
}
