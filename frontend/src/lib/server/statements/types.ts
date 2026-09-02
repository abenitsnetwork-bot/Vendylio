// Frozen shape of a WithdrawalStatement.data blob. Everything the PDF needs,
// captured at generation time so a later refund never rewrites history. All
// money fields are integer cents.
import 'server-only';

/** One payment-method row of the "activity over the period" section. */
export interface StatementSalesGroup {
  /** Order.provider value. */
  provider: 'stripe_platform' | 'stripe_connect' | 'cashapp_manual' | 'zelle_manual' | string;
  /** Human label ("Card — paid out by Vendylio", "Cash App / Zelle", …). */
  label: string;
  /** Where the money physically landed — drives the "info only" note. */
  settlement: 'vendylio' | 'seller_stripe' | 'seller_direct';
  orderCount: number;
  grossCents: number;
  commissionCents: number;
  /** grossCents - commissionCents. */
  netCents: number;
}

/** One line of commission withheld from THIS payout. */
export interface StatementCommissionLine {
  orderNumber: string; // "VND-10042"
  /** SALE (positive, merchant owes) | REFUND_CREDIT (negative, credit back). */
  kind: string;
  /** When the charge was accrued. */
  accruedAt: string; // ISO
  amountCents: number; // signed
}

export interface StatementData {
  schemaVersion: 1;
  storeName: string;
  storeSlug: string;
  currency: string;
  periodFrom: string; // ISO
  periodTo: string; // ISO
  generatedAt: string; // ISO

  /** Section 1 — activity over the period, grouped by payment method. */
  sales: StatementSalesGroup[];
  salesTotals: {
    orderCount: number;
    grossCents: number;
    commissionCents: number;
    netCents: number;
  };
  /** Refunds issued to buyers during the period (reduce what the seller keeps). */
  refunds: {
    orderCount: number;
    amountCents: number;
  };
  /** Taxes line — always present, $0.00 in v1 (no tax engine). */
  taxCents: number;

  /** Section 2 — the hard numbers for this specific payout. */
  payout: {
    withdrawalId: string;
    method: string; // "Cash App $tag", "Zelle you@x.com", "Bank (ACH via Stripe)"
    status: string;
    requestedAt: string; // ISO
    completedAt: string | null; // ISO
    /** Withdrawal.amount — the gross debit. */
    grossCents: number;
    /** Withdrawal.commissionSettledCents — total commission withheld. */
    commissionWithheldCents: number;
    /** Itemised commission lines settled by this withdrawal (FIFO). */
    commissionLines: StatementCommissionLine[];
    /** grossCents - commissionWithheldCents — what the seller actually receives. */
    netPayableCents: number;
  };
}

export interface BuiltStatement {
  storeId: string;
  data: StatementData;
  periodFrom: Date;
  periodTo: Date;
  currency: string;
  grossSalesCents: number;
  totalDeductionsCents: number;
  netPayableCents: number;
}
