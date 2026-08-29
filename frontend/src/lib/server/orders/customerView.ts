// Phase 7 — the customer-facing projection of an order.
//
// Internal order/delivery states are backend vocabulary. Everything a guest
// sees (tracking page, transactional emails) goes through this module so the
// mapping lives in exactly one place (§68) and a schema change to the
// lifecycle can't silently contradict the customer view (§153/§154).
//
// Never fabricate events or timestamps — every timeline entry is backed by a
// real OrderStatusEvent row (§13).
import 'server-only';

export type FulfillmentMethod = 'PICKUP' | 'DELIVERY';

export interface CustomerStatus {
  /** Stable key for UI branching + accessible announcements. */
  key:
    | 'PROCESSING'
    | 'CONFIRMED'
    | 'PREPARING'
    | 'READY'
    | 'ON_THE_WAY'
    | 'DELIVERED'
    | 'CANCELLED'
    | 'REFUNDED'
    | 'EXPIRED'
    | 'PAYMENT_FAILED';
  label: string;
  description: string;
}

/**
 * Map an internal Order.status to the single customer-facing status shown at
 * the top of the tracking page. `fulfillmentMethod` only changes wording for
 * the pickup flow (nothing is ever "on the way" when the buyer collects in
 * person).
 */
export function mapOrderStatusForCustomer(
  status: string,
  fulfillmentMethod: FulfillmentMethod,
): CustomerStatus {
  const isPickup = fulfillmentMethod === 'PICKUP';
  switch (status) {
    case 'PENDING':
      return {
        key: 'PROCESSING',
        label: 'Confirming your order',
        description: "We're confirming your payment. This page updates on its own.",
      };
    case 'PAID':
      return {
        key: 'CONFIRMED',
        label: 'Order confirmed',
        description: "We've received your order and payment. The store has been notified.",
      };
    case 'PREPARING':
      return {
        key: 'PREPARING',
        label: 'Being prepared',
        description: 'The store is preparing your order.',
      };
    case 'READY':
      return isPickup
        ? {
            key: 'READY',
            label: 'Ready for pickup',
            description: 'Your order is ready — come by whenever works.',
          }
        : {
            key: 'READY',
            label: 'Ready',
            description: 'Your order is ready and will be on its way shortly.',
          };
    case 'OUT_FOR_DELIVERY':
      return {
        key: 'ON_THE_WAY',
        label: 'On the way',
        description: 'Your order is on the way.',
      };
    case 'DELIVERED':
      return isPickup
        ? { key: 'DELIVERED', label: 'Picked up', description: 'Order collected. Enjoy!' }
        : {
            key: 'DELIVERED',
            label: 'Delivered',
            description: 'Your order has been delivered. We hope you loved it!',
          };
    case 'CANCELLED':
      return {
        key: 'CANCELLED',
        label: 'Cancelled',
        description: 'This order was cancelled.',
      };
    case 'REFUNDED':
      return {
        key: 'REFUNDED',
        label: 'Refunded',
        description:
          'This order was refunded. The funds return to your original payment method within 5–10 business days.',
      };
    case 'EXPIRED':
      return {
        key: 'EXPIRED',
        label: 'Expired',
        description: 'This order was never completed and has expired. You were not charged.',
      };
    case 'FAILED':
      return {
        key: 'PAYMENT_FAILED',
        label: 'Payment not completed',
        description: 'We couldn’t complete the payment for this order. You were not charged.',
      };
    default:
      return {
        key: 'PROCESSING',
        label: 'Processing',
        description: 'Your order is being processed.',
      };
  }
}

export interface TimelineStep {
  key: 'CONFIRMED' | 'PREPARING' | 'READY' | 'ON_THE_WAY' | 'DELIVERED';
  label: string;
  /** 'done' — reached; 'current' — the step in progress; 'upcoming' — not yet. */
  state: 'done' | 'current' | 'upcoming';
  /** ISO timestamp of the earliest event that reached this step, when done. */
  at: string | null;
}

interface StepDef {
  key: TimelineStep['key'];
  label: string;
  /** Internal Order.status values that count as "this step reached". */
  matches: string[];
}

function stepDefs(fulfillmentMethod: FulfillmentMethod): StepDef[] {
  const isPickup = fulfillmentMethod === 'PICKUP';
  const steps: StepDef[] = [
    { key: 'CONFIRMED', label: 'Order confirmed', matches: ['PAID'] },
    { key: 'PREPARING', label: 'Being prepared', matches: ['PREPARING'] },
    {
      key: 'READY',
      label: isPickup ? 'Ready for pickup' : 'Ready',
      matches: ['READY'],
    },
  ];
  if (!isPickup) {
    steps.push({ key: 'ON_THE_WAY', label: 'On the way', matches: ['OUT_FOR_DELIVERY'] });
  }
  steps.push({
    key: 'DELIVERED',
    label: isPickup ? 'Picked up' : 'Delivered',
    matches: ['DELIVERED'],
  });
  return steps;
}

export interface OrderEventInput {
  status: string;
  createdAt: Date | string;
}

/**
 * Build the customer progress timeline from the raw OrderStatusEvent rows.
 *
 * Out-of-order protection (§152/§223): the customer view never regresses. We
 * take the FURTHEST step any event reached — a stale `PREPARING` webhook that
 * lands after `DELIVERED` can't pull the timeline backward. Duplicate events
 * for the same step collapse to the earliest timestamp (§222).
 */
export function buildOrderTimeline(
  events: OrderEventInput[],
  fulfillmentMethod: FulfillmentMethod,
): TimelineStep[] {
  const defs = stepDefs(fulfillmentMethod);
  const indexOfStatus = (status: string): number =>
    defs.findIndex((d) => d.matches.includes(status));

  let furthest = -1;
  const earliestAt: (number | null)[] = defs.map(() => null);

  for (const ev of events) {
    const idx = indexOfStatus(ev.status);
    if (idx === -1) continue;
    if (idx > furthest) furthest = idx;
    const ms = new Date(ev.createdAt).getTime();
    if (Number.isNaN(ms)) continue;
    const prev = earliestAt[idx] ?? null;
    if (prev === null || ms < prev) earliestAt[idx] = ms;
  }

  return defs.map((def, i) => {
    const state: TimelineStep['state'] =
      i <= furthest ? 'done' : i === furthest + 1 ? 'current' : 'upcoming';
    const atMs = earliestAt[i] ?? null;
    return {
      key: def.key,
      label: def.label,
      state,
      at: state === 'done' && atMs !== null ? new Date(atMs).toISOString() : null,
    };
  });
}

const CLOSED_STATUSES = new Set(['CANCELLED', 'REFUNDED', 'EXPIRED', 'FAILED']);

export function isClosedStatus(status: string): boolean {
  return CLOSED_STATUSES.has(status);
}
