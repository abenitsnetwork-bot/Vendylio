// Shared shape for every admin report. A builder returns this; the same
// object feeds the in-page preview, the CSV export and the PDF export, so
// there is exactly one definition of each report's columns and numbers.
//
// No `server-only` here — the client preview imports these types and the
// `format.ts` helpers. Builders + registry are server-only on their own.

export type ReportType =
  | 'platform-revenue'
  | 'payouts'
  | 'commission-receivables'
  | 'gmv-sales'
  | 'store-performance'
  | 'orders'
  | 'deliveries'
  | 'refunds'
  | 'onboarding-funnel'
  | 'storefront-traffic'
  | 'business-waitlist'
  | 'contact-messages'
  | 'admin-activity'
  | 'seller-tax-summary'
  | 'sales-tax-nexus'
  | 'suspended-accounts'
  | 'product-performance'
  | 'dead-stock'
  | 'inventory-valuation'
  | 'stock-movements'
  | 'promo-performance'
  | 'customers'
  | 'reviews'
  | 'webhook-health'
  | 'email-delivery'
  | 'disputes'
  | 'reconciliation-discrepancies'
  | 'financial-events';

export type ColumnFormat = 'text' | 'usd' | 'number' | 'percent' | 'date';

export interface ReportColumn {
  key: string;
  label: string;
  /** How preview + PDF render the cell. CSV always emits the raw value. */
  format?: ColumnFormat;
}

export interface ReportKpi {
  label: string;
  /** Already formatted for display (e.g. "$1,240.00", "37", "4.2%"). */
  value: string;
}

export interface ReportData {
  type: ReportType;
  title: string;
  /** null period = a point-in-time snapshot (e.g. receivables aging). */
  period: { from: string; to: string; label: string } | null;
  generatedAt: string;
  kpis: ReportKpi[];
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  /** Caveats shown under the table / in the export footer. */
  notes?: string[];
}

export interface ReportArgs {
  /** Inclusive start / exclusive end, ISO. Ignored by snapshot reports. */
  from: Date;
  to: Date;
  /** Optional single-store filter (Store.id). */
  storeId?: string | undefined;
  /** Phase 2G — Financial Event Explorer filters. Only 'financial-events'
   *  reads these; every other builder ignores them. FinancialEvent.eventType
   *  is a free-text column (no DB enum), so this stays a plain string rather
   *  than a closed union — the explorer only offers the eventTypes the
   *  architecture actually writes (see financialEvents.ts), never invents
   *  new ones. */
  eventType?: string | undefined;
  provider?: string | undefined;
  sourceType?: string | undefined;
  sourceId?: string | undefined;
  orderId?: string | undefined;
}

export interface ReportDef {
  type: ReportType;
  label: string;
  description: string;
  /** false = a snapshot; the UI hides the date range picker. */
  usesDateRange: boolean;
  /** true = the UI offers the optional store filter. */
  usesStoreFilter: boolean;
  /** true = the UI offers the optional FinancialEvent.eventType filter
   *  (Phase 2G — the Financial Event Explorer is the only report using it). */
  usesEventTypeFilter?: boolean;
  build: (args: ReportArgs) => Promise<ReportData>;
}
