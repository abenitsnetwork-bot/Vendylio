// The single source of truth for "this order was really paid" when computing
// sales / revenue / GMV aggregates.
//
// `Order.status` is a moving lifecycle column: PAID → PREPARING → READY →
// OUT_FOR_DELIVERY → DELIVERED. An exact `status: 'PAID'` match makes a sale
// vanish from every aggregate the moment the seller advances the order past
// the first post-payment step — the regression fixed in
// api/stores/me/route.ts and lib/server/withdrawals/balance.ts, and the same
// bug that was live in the admin dashboard routes (pulse / analytics /
// stores/overview / stats).
//
// REFUNDED / CANCELLED / EXPIRED / FAILED are deliberately excluded: that
// money is not a completed sale. Anything that has reached PAID and moved
// forward still is.
export const PAID_ORDER_STATUSES = [
  'PAID',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;

/** Prisma `where` fragment: `{ status: { in: [...] } }`. */
export const paidOrderStatusFilter = { status: { in: [...PAID_ORDER_STATUSES] } } as const;
