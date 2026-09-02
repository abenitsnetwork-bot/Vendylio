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
  | 'store-performance';

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
}

export interface ReportDef {
  type: ReportType;
  label: string;
  description: string;
  /** false = a snapshot; the UI hides the date range picker. */
  usesDateRange: boolean;
  /** true = the UI offers the optional store filter. */
  usesStoreFilter: boolean;
  build: (args: ReportArgs) => Promise<ReportData>;
}
