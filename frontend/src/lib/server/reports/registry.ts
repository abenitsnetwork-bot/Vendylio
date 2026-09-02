import 'server-only';
import type { ReportDef, ReportType } from './types';
import { buildPlatformRevenue } from './builders/platformRevenue';
import { buildPayouts } from './builders/payouts';
import { buildCommissionReceivables } from './builders/commissionReceivables';
import { buildGmvSales } from './builders/gmvSales';
import { buildStorePerformance } from './builders/storePerformance';
import { buildOrders } from './builders/orders';
import { buildDeliveries } from './builders/deliveries';
import { buildRefunds } from './builders/refunds';
import { buildOnboardingFunnel } from './builders/onboardingFunnel';
import { buildStorefrontTraffic } from './builders/storefrontTraffic';
import { buildBusinessWaitlist } from './builders/businessWaitlist';
import { buildAdminActivity } from './builders/adminActivity';
import { buildSellerTaxSummary } from './builders/sellerTaxSummary';
import { buildSuspendedAccounts } from './builders/suspendedAccounts';

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
  orders: {
    type: 'orders',
    label: 'Orders',
    description:
      'Every checkout created in the period — store, status, payment method, totals — paid or not.',
    usesDateRange: true,
    usesStoreFilter: true,
    build: buildOrders,
  },
  deliveries: {
    type: 'deliveries',
    label: 'Deliveries',
    description:
      'Every delivery created in the period — provider, final state, fee charged vs provider cost.',
    usesDateRange: true,
    usesStoreFilter: true,
    build: buildDeliveries,
  },
  refunds: {
    type: 'refunds',
    label: 'Refunds',
    description:
      'Orders refunded in the period, by the date the refund was issued — amount and commission reversed.',
    usesDateRange: true,
    usesStoreFilter: true,
    build: buildRefunds,
  },
  'onboarding-funnel': {
    type: 'onboarding-funnel',
    label: 'Onboarding funnel',
    description:
      'How far each cohort of newly created stores got — product, payments, publish, first order.',
    usesDateRange: true,
    usesStoreFilter: false,
    build: buildOnboardingFunnel,
  },
  'storefront-traffic': {
    type: 'storefront-traffic',
    label: 'Storefront traffic',
    description:
      'Views, unique visitors and product views by store, with a conversion rate for the window.',
    usesDateRange: true,
    usesStoreFilter: true,
    build: buildStorefrontTraffic,
  },
  'business-waitlist': {
    type: 'business-waitlist',
    label: 'Business waitlist',
    description: 'Everyone on the "Business" tier waitlist from the pricing page (snapshot).',
    usesDateRange: false,
    usesStoreFilter: false,
    build: buildBusinessWaitlist,
  },
  'admin-activity': {
    type: 'admin-activity',
    label: 'Admin activity',
    description:
      'Back-office actions in the period, rolled up per admin and action type with counts.',
    usesDateRange: true,
    usesStoreFilter: false,
    build: buildAdminActivity,
  },
  'seller-tax-summary': {
    type: 'seller-tax-summary',
    label: 'Seller tax summary (1099-K)',
    description:
      'Per-store card payment volume processed by Vendylio — the basis for a 1099-K. Excludes Cash App / Zelle.',
    usesDateRange: true,
    usesStoreFilter: true,
    build: buildSellerTaxSummary,
  },
  'suspended-accounts': {
    type: 'suspended-accounts',
    label: 'Suspended accounts',
    description: 'Every currently suspended user account, with the store they run (snapshot).',
    usesDateRange: false,
    usesStoreFilter: false,
    build: buildSuspendedAccounts,
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
