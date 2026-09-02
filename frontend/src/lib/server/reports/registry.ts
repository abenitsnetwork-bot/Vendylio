import 'server-only';
import type { ReportDef, ReportType } from './types';
import { buildPlatformRevenue } from './builders/platformRevenue';
import { buildPayouts } from './builders/payouts';
import { buildCommissionReceivables } from './builders/commissionReceivables';
import { buildGmvSales } from './builders/gmvSales';
import { buildStorePerformance } from './builders/storePerformance';

export const REPORTS: Record<ReportType, ReportDef> = {
  'platform-revenue': {
    type: 'platform-revenue',
    label: 'Platform revenue',
    description:
      'Commission earned by month (card + Cash App / Zelle) plus current subscription MRR.',
    usesDateRange: true,
    usesStoreFilter: false,
    build: buildPlatformRevenue,
  },
  payouts: {
    type: 'payouts',
    label: 'Payouts',
    description:
      'Every withdrawal requested in the period — store, requester, method, gross vs net.',
    usesDateRange: true,
    usesStoreFilter: true,
    build: buildPayouts,
  },
  'commission-receivables': {
    type: 'commission-receivables',
    label: 'Commission receivables (aging)',
    description:
      'Outstanding Cash App / Zelle commission per store, aged 0–30 / 31–60 / 61–90 / 90+.',
    usesDateRange: false,
    usesStoreFilter: true,
    build: buildCommissionReceivables,
  },
  'gmv-sales': {
    type: 'gmv-sales',
    label: 'GMV & sales',
    description:
      'Gross merchandise value by store — orders, GMV, refunds, AOV, commission generated.',
    usesDateRange: true,
    usesStoreFilter: true,
    build: buildGmvSales,
  },
  'store-performance': {
    type: 'store-performance',
    label: 'Store performance',
    description:
      'Per-store activity in the window — orders, GMV, visitors, conversion — plus a health flag.',
    usesDateRange: true,
    usesStoreFilter: true,
    build: buildStorePerformance,
  },
};

export const REPORT_LIST = Object.values(REPORTS).map((r) => ({
  type: r.type,
  label: r.label,
  description: r.description,
  usesDateRange: r.usesDateRange,
  usesStoreFilter: r.usesStoreFilter,
}));

export function isReportType(v: string): v is ReportType {
  return v in REPORTS;
}
