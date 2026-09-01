// Phase 1b — collection-of-last-resort for Cash App / Zelle marketplace
// commission.
//
// The happy path withholds a merchant's OWED commission from their next
// withdrawal (api/withdrawals/route.ts). A merchant who only ever sells via
// Cash App / Zelle has no withdrawable balance, so their OWED balance would
// sit forever. This sweep (daily cron) invoices any store whose OWED total
// clears `COMMISSION_MIN_INVOICE_CENTS` on the Stripe billing customer
// (`charge_automatically`), then `invoice.paid` (→ stripe-billing webhook)
// flips the rows OWED → INVOICED → SETTLED.
//
// Enabling Cash App / Zelle in store settings requires a card on file
// (PATCH /api/stores → PAYMENT_METHOD_REQUIRED), so a store with OWED
// commission accrued after that gate is guaranteed to be invoiceable.
import 'server-only';
import type { PrismaClient } from '@prisma/client';
import type { PrismaTransactionClient } from '@/lib/server/webhook/handler';
import { formatOrderNumber } from '@/lib/orderNumber';
import {
  isBillingConfigured,
  createCommissionInvoice,
  hasBillablePaymentMethod,
} from './stripe-billing';

export const DEFAULT_MIN_INVOICE_CENTS = 1000;

export function minInvoiceCents(): number {
  const raw = Number(process.env.COMMISSION_MIN_INVOICE_CENTS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MIN_INVOICE_CENTS;
}

/**
 * `invoice.paid` handler — flip every INVOICED CommissionCharge stamped with
 * this invoice to SETTLED. A no-op for a subscription-renewal invoice (no rows
 * carry its id). Runs inside the webhook factory's Serializable tx.
 */
export async function settleInvoicedCommission(
  tx: PrismaTransactionClient,
  invoiceId: string,
): Promise<number> {
  const res = await tx.commissionCharge.updateMany({
    where: { stripeInvoiceId: invoiceId, status: 'INVOICED' },
    data: { status: 'SETTLED', settledAt: new Date() },
  });
  return res.count;
}

export interface CommissionSweepResult {
  storesInvoiced: number;
  chargesInvoiced: number;
  centsInvoiced: number;
  skippedBelowMin: number;
  skippedNoCard: number;
}

type SweepClient = Pick<PrismaClient, 'commissionCharge' | 'store'>;

/**
 * Invoice every store whose OWED commission clears the minimum. Positive and
 * negative (REFUND_CREDIT) OWED rows are netted onto one invoice; a store
 * whose net is below the minimum (or negative) is left for the withdrawal
 * path. Best-effort per store — one store's Stripe failure doesn't abort the
 * others.
 */
export async function sweepCommissionSettlement(
  prisma: SweepClient,
  opts: { min?: number } = {},
): Promise<CommissionSweepResult> {
  const result: CommissionSweepResult = {
    storesInvoiced: 0,
    chargesInvoiced: 0,
    centsInvoiced: 0,
    skippedBelowMin: 0,
    skippedNoCard: 0,
  };
  if (!isBillingConfigured()) return result;

  const min = opts.min ?? minInvoiceCents();

  const grouped = await prisma.commissionCharge.groupBy({
    by: ['storeId'],
    where: { status: 'OWED' },
    _sum: { amountCents: true },
  });

  for (const g of grouped) {
    const owed = g._sum.amountCents ?? 0;
    if (owed < min) {
      result.skippedBelowMin += 1;
      continue;
    }

    const store = await prisma.store.findUnique({
      where: { id: g.storeId },
      select: { id: true, stripeCustomerId: true },
    });
    if (!store?.stripeCustomerId) {
      result.skippedNoCard += 1;
      continue;
    }
    if (!(await hasBillablePaymentMethod(store.stripeCustomerId))) {
      result.skippedNoCard += 1;
      continue;
    }

    const rows = await prisma.commissionCharge.findMany({
      where: { storeId: g.storeId, status: 'OWED' },
      select: { id: true, amountCents: true, order: { select: { orderNumber: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const netCents = rows.reduce((s, r) => s + r.amountCents, 0);
    if (netCents < min) {
      result.skippedBelowMin += 1;
      continue;
    }

    let invoiceId: string;
    try {
      const inv = await createCommissionInvoice({
        customerId: store.stripeCustomerId,
        storeId: store.id,
        lines: rows.map((r) => ({
          amountCents: r.amountCents,
          description: `Commission — order ${formatOrderNumber(r.order.orderNumber)}`,
        })),
      });
      invoiceId = inv.invoiceId;
    } catch {
      // Stripe hiccup — leave the rows OWED, retry next tick.
      result.skippedNoCard += 0;
      continue;
    }

    const upd = await prisma.commissionCharge.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, status: 'OWED' },
      data: { status: 'INVOICED', stripeInvoiceId: invoiceId },
    });

    result.storesInvoiced += 1;
    result.chargesInvoiced += upd.count;
    result.centsInvoiced += netCents;
  }

  return result;
}
