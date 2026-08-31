/**
 * Prompt #12 — the normalized fulfillment state machine.
 *
 * ONE place decides whether a state change is legal and what it means for the
 * commercial `Order.status`. Webhooks, the poll cron, the dispatch cron and
 * merchant clicks all go through `service.ts`, which consults this module —
 * no route touches `Delivery.state` or `Order.status` directly.
 *
 *   PENDING → QUOTED → REQUESTED → CONFIRMED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
 *   terminal: CANCELLED, FAILED
 *
 * `UNKNOWN` is never stored: an event that normalizes to UNKNOWN is written to
 * `DeliveryEvent` (for forensics) and logged, and `Delivery.state` is left
 * untouched.
 */
import 'server-only';
import type { FulfillmentActor, NormalizedState } from './types';

/** Monotonic rank along the happy path. Terminal states share the top so a
 *  forward-only guard treats any → terminal as allowed. */
const RANK: Record<NormalizedState, number> = {
  PENDING: 0,
  QUOTED: 1,
  REQUESTED: 2,
  CONFIRMED: 3,
  PICKED_UP: 4,
  OUT_FOR_DELIVERY: 5,
  DELIVERED: 6,
  CANCELLED: 7,
  FAILED: 7,
};

export const TERMINAL_STATES: readonly NormalizedState[] = ['DELIVERED', 'CANCELLED', 'FAILED'];

export function rank(state: NormalizedState): number {
  return RANK[state];
}

export function isTerminal(state: NormalizedState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * Can `from` move to `to`, given who is asking?
 *
 * - PROVIDER / CRON (external truth): forward-only. `rank(to) > rank(from)`,
 *   OR a terminal correction (`to` terminal, `from` not terminal). A replayed
 *   or out-of-order lower-rank event returns `false` here — the caller still
 *   records the `DeliveryEvent`, it just doesn't move `Delivery.state`
 *   (same "furthest reached wins / never regress" rule as `buildOrderTimeline`).
 * - MERCHANT (self-delivery only — enforced at the call site): the manual
 *   happy path PENDING → REQUESTED → OUT_FOR_DELIVERY → DELIVERED, plus
 *   `* → CANCELLED` from any non-terminal state.
 * - SYSTEM: the initial `→ PENDING` (create) and the `FAILED → PENDING` retry
 *   (the caller separately verifies there is no live external delivery first).
 */
export function canTransition(
  from: NormalizedState,
  to: NormalizedState,
  actor: FulfillmentActor,
): boolean {
  if (from === to) return false;

  if (actor === 'SYSTEM') {
    if (to === 'PENDING') return from === 'FAILED'; // retry
    return rank(to) > rank(from) && !isTerminal(from);
  }

  if (actor === 'MERCHANT') {
    if (to === 'CANCELLED') return !isTerminal(from);
    const MANUAL_PATH: NormalizedState[] = [
      'PENDING',
      'REQUESTED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ];
    const i = MANUAL_PATH.indexOf(from);
    const j = MANUAL_PATH.indexOf(to);
    return i !== -1 && j === i + 1;
  }

  // PROVIDER | CRON
  if (isTerminal(from)) return false;
  if (isTerminal(to)) return true; // terminal correction from any live state
  return rank(to) > rank(from);
}

/**
 * The `Order.status` a Delivery state implies. `null` = leave the order
 * status alone.
 *
 * - PENDING / QUOTED / REQUESTED / CONFIRMED: the courier is being arranged —
 *   the order stays wherever the seller has it (PAID / PREPARING / READY).
 * - PICKED_UP / OUT_FOR_DELIVERY → Order `OUT_FOR_DELIVERY`.
 * - DELIVERED → Order `DELIVERED`.
 * - FAILED / CANCELLED → Order `READY`, but ONLY when it is currently
 *   `OUT_FOR_DELIVERY` (a courier hiccup must not pull back an order the
 *   seller already moved on from). An order is NEVER auto-CANCELLED or
 *   auto-REFUNDED by a delivery failure — that stays a manual seller action.
 */
export function mapToOrderStatus(state: NormalizedState): {
  target: string | null;
  onlyIfCurrentlyOutForDelivery?: boolean;
} {
  switch (state) {
    case 'PICKED_UP':
    case 'OUT_FOR_DELIVERY':
      return { target: 'OUT_FOR_DELIVERY' };
    case 'DELIVERED':
      return { target: 'DELIVERED' };
    case 'FAILED':
    case 'CANCELLED':
      return { target: 'READY', onlyIfCurrentlyOutForDelivery: true };
    default:
      return { target: null };
  }
}
