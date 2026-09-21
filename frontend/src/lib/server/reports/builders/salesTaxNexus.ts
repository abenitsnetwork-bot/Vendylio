import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

// The classic post-Wayfair economic-nexus thresholds most states originally
// adopted: $100k of sales OR 200 transactions sourced to that state in a
// year triggers an obligation to register and collect sales tax there.
// Many states have since dropped the 200-transaction prong or raised the
// dollar figure — this is a starting-point hint, not a filed determination.
// Flag on EITHER prong (the safer, earlier-warning reading).
const GROSS_THRESHOLD_CENTS = 10_000_000; // $100,000
const TXN_THRESHOLD = 200;

/** USPS 2-letter code -> full name, for display; also doubles as the valid-code set. */
const US_STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  PR: 'Puerto Rico',
};

// Full-name -> code, built from the table above so the two never drift.
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toUpperCase(), code]),
);

/**
 * Best-effort normalization of a free-text "state" field (both the storefront
 * checkout form and Store settings take plain text, not a validated select)
 * into a USPS 2-letter code. Returns null when it can't be confidently
 * resolved — those orders land in an explicit "Unknown" bucket rather than
 * being silently dropped or mis-bucketed.
 */
export function normalizeUsState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper in US_STATES) return upper;
  return NAME_TO_CODE[upper] ?? null;
}

function isDeliveryAddressState(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as Record<string, unknown>).state;
  return typeof raw === 'string' ? raw : null;
}

/**
 * Revenue + transaction count by US state, across ALL payment methods (card,
 * Cash App, Zelle — unlike the 1099-K seller-tax-summary report, sales-tax
 * nexus cares about total sales activity in a state, not who processed the
 * money). Sourced from the buyer's delivery address for DELIVERY orders,
 * falling back to the selling store's own state for PICKUP orders (the sale
 * is completed at the store) and for any order missing an address.
 *
 * This is a monitoring tool, not a tax filing: it flags states approaching
 * or over the classic $100k / 200-transaction economic-nexus thresholds so
 * registration can be looked into before it becomes overdue.
 */
export async function buildSalesTaxNexus({ from, to }: ReportArgs): Promise<ReportData> {
  const where: Prisma.OrderWhereInput = {
    paidAt: { gte: from, lt: to },
    status: { in: [...PAID_ORDER_STATUSES, 'REFUNDED'] },
  };

  const orders = await prisma.order.findMany({
    where,
    select: {
      storeId: true,
      amount: true,
      status: true,
      fulfillmentMethod: true,
      deliveryAddress: true,
    },
  });

  const storeIds = [...new Set(orders.map((o) => o.storeId))];
  const stores = storeIds.length
    ? await prisma.store.findMany({
        where: { id: { in: storeIds } },
        select: { id: true, state: true },
      })
    : [];
  const storeStateById = new Map(stores.map((s) => [s.id, normalizeUsState(s.state)]));

  interface Agg {
    gross: number;
    refunds: number;
    txns: number;
  }
  const byState = new Map<string, Agg>();
  const getAgg = (key: string) => {
    let a = byState.get(key);
    if (!a) {
      a = { gross: 0, refunds: 0, txns: 0 };
      byState.set(key, a);
    }
    return a;
  };

  for (const o of orders) {
    const fromAddress =
      o.fulfillmentMethod === 'DELIVERY'
        ? normalizeUsState(isDeliveryAddressState(o.deliveryAddress))
        : null;
    const resolved = fromAddress ?? storeStateById.get(o.storeId) ?? null;
    const key = resolved ?? 'Unknown';
    const a = getAgg(key);
    if (o.status === 'REFUNDED') {
      a.refunds += o.amount;
    } else {
      a.gross += o.amount;
      a.txns += 1;
    }
  }

  const rows = [...byState.entries()]
    .map(([key, a]) => {
      const flagged = a.gross >= GROSS_THRESHOLD_CENTS || a.txns >= TXN_THRESHOLD;
      return {
        state: key === 'Unknown' ? 'Unknown' : `${US_STATES[key] ?? key} (${key})`,
        gross: a.gross,
        refunds: a.refunds,
        netGmv: a.gross - a.refunds,
        transactions: a.txns,
        flag: flagged ? 'Nexus review' : '',
      };
    })
    .sort((x, y) => y.gross - x.gross);

  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const totalRefunds = rows.reduce((s, r) => s + r.refunds, 0);
  const totalTxns = rows.reduce((s, r) => s + r.transactions, 0);
  const flaggedCount = rows.filter((r) => r.flag).length;
  const unknownRow = rows.find((r) => r.state === 'Unknown');

  return {
    type: 'sales-tax-nexus',
    title: 'Sales-tax nexus tracker',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'States over threshold', value: String(flaggedCount) },
      { label: 'Total sales (window)', value: usd(totalGross) },
      { label: 'Refunds', value: usd(totalRefunds) },
      { label: 'Total transactions', value: totalTxns.toLocaleString('en-US') },
      { label: 'Unsourced revenue', value: usd(unknownRow?.gross ?? 0) },
    ],
    columns: [
      { key: 'state', label: 'State' },
      { key: 'gross', label: 'Gross sales', format: 'usd' },
      { key: 'refunds', label: 'Refunds', format: 'usd' },
      { key: 'netGmv', label: 'Net sales', format: 'usd' },
      { key: 'transactions', label: 'Transactions', format: 'number' },
      { key: 'flag', label: 'Threshold' },
    ],
    rows,
    notes: [
      'All payment methods (card, Cash App, Zelle) are included — unlike the 1099-K report, sales-tax nexus is about total sales activity in a state, not who processed the payment.',
      "DELIVERY orders are sourced to the buyer's delivery-address state; PICKUP orders (and any order missing an address) fall back to the selling store's own state.",
      'Both the buyer address and the store address are free-text fields, not a validated state select — entries that cannot be matched to a US state land in "Unknown" rather than being guessed at.',
      `The $100,000 / 200-transaction flag is the classic Wayfair-era threshold most states originally adopted. Many have since dropped the transaction count or use a different dollar figure — treat this as a hint to look into registration, not a filed nexus determination.`,
      'Economic-nexus thresholds are typically measured over a calendar year (some states use a trailing 12 months). Run this report over a 12-month window for the flag to be meaningful — a short window will under-flag.',
    ],
  };
}
