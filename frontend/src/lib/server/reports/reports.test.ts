import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, type Mock } from 'vitest';

// Prisma's groupBy has an overloaded signature that mockDeep's types don't
// expose `.mockResolvedValue` on — same helper the pulse route test uses.
const groupByMock = (m: unknown) => m as unknown as Mock;

import { REPORTS, REPORT_LIST, isReportType } from './registry';
import { reportToCsv } from './csv';
import { renderReportPdf } from './pdf';
import { formatCell, periodLabel } from './format';
import { formatOrderNumber } from '@/lib/orderNumber';
import type { ReportArgs } from './types';

const ARGS: ReportArgs = {
  from: new Date('2026-08-01T00:00:00Z'),
  to: new Date('2026-09-01T00:00:00Z'),
};

beforeEach(() => {
  // Every builder reads a handful of tables — default them all to empty.
  prismaMock.order.findMany.mockResolvedValue([] as never);
  groupByMock(prismaMock.order.groupBy).mockResolvedValue([]);
  prismaMock.commissionCharge.findMany.mockResolvedValue([] as never);
  prismaMock.withdrawal.findMany.mockResolvedValue([] as never);
  prismaMock.store.findMany.mockResolvedValue([] as never);
  prismaMock.store.findUnique.mockResolvedValue(null as never);
  prismaMock.organizationMember.findMany.mockResolvedValue([] as never);
  groupByMock(prismaMock.storefrontDayStat.groupBy).mockResolvedValue([]);
  // Lot 2 builders
  prismaMock.delivery.findMany.mockResolvedValue([] as never);
  prismaMock.orderStatusEvent.findMany.mockResolvedValue([] as never);
  prismaMock.product.findMany.mockResolvedValue([] as never);
  prismaMock.adminAction.findMany.mockResolvedValue([] as never);
  prismaMock.businessLead.findMany.mockResolvedValue([] as never);
  prismaMock.contactMessage.findMany.mockResolvedValue([] as never);
  prismaMock.user.findMany.mockResolvedValue([] as never);
  // Lot 3 builders
  prismaMock.stockMovement.findMany.mockResolvedValue([] as never);
  groupByMock(prismaMock.stockMovement.groupBy).mockResolvedValue([]);
  prismaMock.discount.findMany.mockResolvedValue([] as never);
  prismaMock.customer.findMany.mockResolvedValue([] as never);
  prismaMock.review.findMany.mockResolvedValue([] as never);
  prismaMock.webhookLog.findMany.mockResolvedValue([] as never);
  prismaMock.emailJob.findMany.mockResolvedValue([] as never);
  // Phase 2G builders (disputes, reconciliation-discrepancies,
  // financial-events, + the gmv-sales/orders extensions)
  prismaMock.dispute.findMany.mockResolvedValue([] as never);
  prismaMock.financialEvent.findMany.mockResolvedValue([] as never);
});

describe('report registry', () => {
  it('REPORT_LIST mirrors REPORTS', () => {
    expect(REPORT_LIST.map((r) => r.type).sort()).toEqual(Object.keys(REPORTS).sort());
  });

  it('isReportType guards unknown values', () => {
    expect(isReportType('payouts')).toBe(true);
    expect(isReportType('nope')).toBe(false);
  });

  for (const def of Object.values(REPORTS)) {
    it(`builds "${def.type}" into a valid ReportData shape`, async () => {
      const report = await def.build(ARGS);
      expect(report.type).toBe(def.type);
      expect(typeof report.title).toBe('string');
      expect(Array.isArray(report.kpis)).toBe(true);
      expect(report.columns.length).toBeGreaterThan(0);
      expect(Array.isArray(report.rows)).toBe(true);
      // period presence matches the registry flag
      expect(report.period === null).toBe(!def.usesDateRange);
      // rows are keyed by every column
      for (const row of report.rows) {
        for (const c of report.columns) expect(c.key in row).toBe(true);
      }
      // serializers accept it
      expect(reportToCsv(report).startsWith('﻿')).toBe(true);
      const pdf = await renderReportPdf(report);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    });
  }
});

describe('platform-revenue numbers', () => {
  it('splits card vs Cash App/Zelle commission by month and totals them', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      { paidAt: new Date('2026-08-05T00:00:00Z'), commissionAmount: 250 },
      { paidAt: new Date('2026-08-20T00:00:00Z'), commissionAmount: 150 },
    ] as never);
    prismaMock.commissionCharge.findMany.mockResolvedValue([
      { settledAt: new Date('2026-08-10T00:00:00Z'), amountCents: 100 },
      { settledAt: new Date('2026-08-15T00:00:00Z'), amountCents: -20 }, // refund credit
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([
      { subscriptionStatus: 'ACTIVE', subscriptionInterval: 'month', planSource: 'SUBSCRIPTION' },
      { subscriptionStatus: null, subscriptionInterval: null, planSource: 'COMP' },
    ] as never);

    const r = await REPORTS['platform-revenue'].build(ARGS);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ card: 400, manual: 80, total: 480 });
    expect(r.kpis.find((k) => k.label === 'Current MRR')?.value).toBe('$29.00');
    expect(r.kpis.find((k) => k.label === 'Comped Pro')?.value).toBe('1');
  });
});

describe('commission-receivables aging', () => {
  it('buckets OWED by age and separates INVOICED', async () => {
    const now = Date.now();
    prismaMock.commissionCharge.findMany.mockResolvedValue([
      {
        storeId: 's1',
        amountCents: 500,
        status: 'OWED',
        createdAt: new Date(now - 5 * 86_400_000),
      },
      {
        storeId: 's1',
        amountCents: 300,
        status: 'OWED',
        createdAt: new Date(now - 100 * 86_400_000),
      },
      {
        storeId: 's1',
        amountCents: 200,
        status: 'INVOICED',
        createdAt: new Date(now - 2 * 86_400_000),
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([
      { id: 's1', name: 'Shop One', slug: 's1' },
    ] as never);

    const r = await REPORTS['commission-receivables'].build(ARGS);
    expect(r.period).toBeNull();
    expect(r.rows[0]).toMatchObject({
      store: 'Shop One',
      owed: 800,
      b0: 500,
      b90: 300,
      invoiced: 200,
    });
    expect(r.kpis.find((k) => k.label === 'Owed 90+ days')?.value).toBe('$3.00');
  });
});

describe('orders report', () => {
  it('splits paid vs abandoned and totals gross paid', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        orderNumber: 1,
        createdAt: new Date('2026-08-02T00:00:00Z'),
        storeId: 's1',
        status: 'DELIVERED',
        provider: 'stripe_platform',
        fulfillmentMethod: 'DELIVERY',
        subtotalCents: 1000,
        deliveryFeeCents: 300,
        discountCents: 0,
        amount: 1300,
      },
      {
        orderNumber: 2,
        createdAt: new Date('2026-08-03T00:00:00Z'),
        storeId: 's1',
        status: 'PENDING',
        provider: 'stripe_platform',
        fulfillmentMethod: 'PICKUP',
        subtotalCents: 500,
        deliveryFeeCents: 0,
        discountCents: 0,
        amount: 500,
      },
      {
        orderNumber: 3,
        createdAt: new Date('2026-08-04T00:00:00Z'),
        storeId: 's1',
        status: 'EXPIRED',
        provider: 'cashapp_manual',
        fulfillmentMethod: 'DELIVERY',
        subtotalCents: 800,
        deliveryFeeCents: 200,
        discountCents: 0,
        amount: 1000,
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', name: 'Shop One' }] as never);

    const r = await REPORTS.orders.build(ARGS);
    expect(r.rows).toHaveLength(3);
    expect(r.kpis.find((k) => k.label === 'Paid')?.value).toBe('1');
    expect(r.kpis.find((k) => k.label === 'Gross paid')?.value).toBe('$13.00');
    expect(r.kpis.find((k) => k.label === 'Abandoned / failed')?.value).toBe('2');
  });
});

describe('onboarding funnel', () => {
  it('counts each step against the created cohort', async () => {
    prismaMock.store.findMany.mockResolvedValue([
      {
        id: 'a',
        createdAt: new Date('2026-08-02T00:00:00Z'),
        published: true,
        publishedAt: new Date('2026-08-04T00:00:00Z'),
        stripeOnboardingStatus: 'ACTIVE',
        cashAppCashtag: null,
        zelleContact: null,
      },
      {
        id: 'b',
        createdAt: new Date('2026-08-05T00:00:00Z'),
        published: false,
        publishedAt: null,
        stripeOnboardingStatus: 'NOT_STARTED',
        cashAppCashtag: null,
        zelleContact: null,
      },
    ] as never);
    prismaMock.product.findMany.mockResolvedValue([{ storeId: 'a' }] as never);
    prismaMock.order.findMany.mockResolvedValue([{ storeId: 'a' }] as never);

    const r = await REPORTS['onboarding-funnel'].build(ARGS);
    expect(r.rows[0]).toMatchObject({ step: 'Created a store', stores: 2 });
    expect(r.rows.find((x) => x.step === 'Published the storefront')).toMatchObject({ stores: 1 });
    expect(r.kpis.find((k) => k.label === 'Activation rate')?.value).toBe('50.0%');
  });
});

describe('product performance', () => {
  it('sums units + revenue from the lineItems snapshot', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        paidAt: new Date('2026-08-03T00:00:00Z'),
        lineItems: [
          { productId: 'p1', name: 'Shea Butter', priceCents: 1800, quantity: 2 },
          { productId: 'p2', name: 'Soap', priceCents: 500, quantity: 1 },
        ],
      },
      {
        paidAt: new Date('2026-08-10T00:00:00Z'),
        lineItems: [{ productId: 'p1', name: 'Shea Butter', priceCents: 1800, quantity: 1 }],
      },
    ] as never);
    prismaMock.product.findMany.mockResolvedValue([
      { id: 'p1', name: 'Shea Butter', status: 'ACTIVE', category: { name: 'Skcare' } },
    ] as never);

    const r = await REPORTS['product-performance'].build(ARGS);
    const p1 = r.rows.find((x) => x.product === 'Shea Butter');
    expect(p1).toMatchObject({ units: 3, revenue: 5400, orders: 2 });
    expect(r.kpis.find((k) => k.label === 'Revenue')?.value).toBe('$59.00');
  });
});

describe('inventory valuation', () => {
  it('values stock at retail and flags low / out', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        storeId: 's1',
        priceCents: 1000,
        quantity: 5,
        lowStockThreshold: null,
        store: { name: 'Shop', defaultLowStockThreshold: 3 },
        variants: [],
      },
      {
        storeId: 's1',
        priceCents: 2000,
        quantity: 2,
        lowStockThreshold: 3,
        store: { name: 'Shop', defaultLowStockThreshold: 3 },
        variants: [],
      },
      {
        storeId: 's1',
        priceCents: 800,
        quantity: 0,
        lowStockThreshold: null,
        store: { name: 'Shop', defaultLowStockThreshold: 3 },
        variants: [],
      },
    ] as never);

    const r = await REPORTS['inventory-valuation'].build(ARGS);
    expect(r.period).toBeNull();
    expect(r.rows[0]).toMatchObject({
      store: 'Shop',
      skus: 3,
      units: 7,
      retailValue: 9000,
      lowStock: 1,
      outOfStock: 1,
    });
  });
});

describe('Phase 2G — Stripe fees & platform contribution (platform-revenue)', () => {
  it('null stripeFeeCents is counted as pending, never estimated as $0', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      { paidAt: new Date('2026-08-05T00:00:00Z'), commissionAmount: 500, stripeFeeCents: 45 },
      { paidAt: new Date('2026-08-06T00:00:00Z'), commissionAmount: 300, stripeFeeCents: null },
    ] as never);

    const r = await REPORTS['platform-revenue'].build(ARGS);
    expect(r.rows[0]).toMatchObject({ total: 800, stripeFees: 45, contribution: 755 });
    expect(r.kpis.find((k) => k.label === 'Stripe fees recorded')?.value).toBe('$0.45');
    expect(r.kpis.find((k) => k.label === 'Stripe fees pending capture')?.value).toBe('1');
    expect(
      r.kpis.find((k) => k.label === 'Platform Contribution Before Operating Costs')?.value,
    ).toBe('$7.55');
  });

  it('never labels the contribution figure as profit', async () => {
    const r = await REPORTS['platform-revenue'].build(ARGS);
    expect(r.kpis.some((k) => /profit/i.test(k.label))).toBe(false);
    expect((r.notes ?? []).some((n) => /not a profit figure/i.test(n))).toBe(true);
  });
});

describe('Phase 2G — GMV & sales extensions (gmv-sales)', () => {
  it('uses the frozen taxableAmountCents when present, and subtotal-minus-discount for a pre-freeze order', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        storeId: 's1',
        amount: 1000,
        subtotalCents: 900,
        discountCents: 100,
        taxableAmountCents: 850, // frozen — authoritative even though it differs from subtotal-discount
        commissionAmount: 50,
        stripeFeeCents: 30,
        status: 'DELIVERED',
      },
      {
        storeId: 's1',
        amount: 500,
        subtotalCents: 500,
        discountCents: 0,
        taxableAmountCents: null, // predates the Phase 2B freeze
        commissionAmount: 25,
        stripeFeeCents: null,
        status: 'PAID',
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', name: 'Shop One' }] as never);

    const r = await REPORTS['gmv-sales'].build(ARGS);
    // 850 (frozen) + 500 (500 - 0 fallback) = 1350
    expect(r.rows[0]).toMatchObject({ merchandiseRevenue: 1350, stripeFees: 30 });
  });

  it('outstanding commission comes from CommissionCharge OWED, not recomputed from Orders', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        storeId: 's1',
        amount: 1000,
        subtotalCents: 1000,
        discountCents: 0,
        taxableAmountCents: 1000,
        commissionAmount: 50,
        stripeFeeCents: 30,
        status: 'PAID',
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', name: 'Shop One' }] as never);
    prismaMock.commissionCharge.findMany.mockResolvedValue([
      { storeId: 's1', amountCents: 777 },
    ] as never);
    prismaMock.dispute.findMany.mockResolvedValue([{ storeId: 's1' }, { storeId: 's1' }] as never);

    const r = await REPORTS['gmv-sales'].build(ARGS);
    expect(r.rows[0]).toMatchObject({ outstandingCommission: 777, disputes: 2 });
  });

  it('tenant isolation — a storeId filter never returns another store’s row', async () => {
    prismaMock.order.findMany.mockImplementation((async (args: {
      where?: { storeId?: string };
    }) => {
      const all = [
        {
          storeId: 's1',
          amount: 1000,
          subtotalCents: 1000,
          discountCents: 0,
          taxableAmountCents: 1000,
          commissionAmount: 50,
          stripeFeeCents: 30,
          status: 'PAID',
        },
        {
          storeId: 's2',
          amount: 2000,
          subtotalCents: 2000,
          discountCents: 0,
          taxableAmountCents: 2000,
          commissionAmount: 100,
          stripeFeeCents: 60,
          status: 'PAID',
        },
      ];
      return args?.where?.storeId ? all.filter((o) => o.storeId === args.where!.storeId) : all;
    }) as never);
    prismaMock.store.findMany.mockResolvedValue([
      { id: 's1', name: 'Shop One' },
      { id: 's2', name: 'Shop Two' },
    ] as never);

    const r = await REPORTS['gmv-sales'].build({ ...ARGS, storeId: 's1' });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.store).toBe('Shop One');
  });
});

describe('Phase 2G — order financial detail (orders report)', () => {
  it('exposes the frozen commission/net/Stripe-fee fields, PaymentIntent, Checkout Session, refund and dispute status', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: 'ord_1',
        orderNumber: 10,
        createdAt: new Date('2026-08-02T00:00:00Z'),
        storeId: 's1',
        status: 'REFUNDED',
        provider: 'stripe_platform',
        fulfillmentMethod: 'DELIVERY',
        subtotalCents: 1000,
        deliveryFeeCents: 0,
        discountCents: 0,
        amount: 1000,
        taxableAmountCents: 1000,
        commissionRateBp: 500,
        commissionAmount: 50,
        netAmount: 950,
        stripeFeeCents: 33,
        stripePaymentIntentId: 'pi_abc',
        providerChargeId: 'cs_abc',
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', name: 'Shop One' }] as never);
    prismaMock.dispute.findMany.mockResolvedValue([{ orderId: 'ord_1', status: 'LOST' }] as never);

    const r = await REPORTS.orders.build(ARGS);
    expect(r.rows[0]).toMatchObject({
      taxableAmount: 1000,
      commissionRate: 5, // 500bp -> 5%
      commission: 50,
      netAmount: 950,
      stripeFee: 33,
      paymentIntentId: 'pi_abc',
      checkoutSessionId: 'cs_abc',
      refundStatus: 'REFUNDED',
      disputeStatus: 'LOST',
    });
  });

  it('a never-disputed order reports disputeStatus NONE and null frozen fields when they predate the freeze', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: 'ord_2',
        orderNumber: 11,
        createdAt: new Date('2026-08-02T00:00:00Z'),
        storeId: 's1',
        status: 'DELIVERED',
        provider: 'stripe_platform',
        fulfillmentMethod: 'DELIVERY',
        subtotalCents: 1000,
        deliveryFeeCents: 0,
        discountCents: 0,
        amount: 1000,
        taxableAmountCents: null,
        commissionRateBp: null,
        commissionAmount: null,
        netAmount: null,
        stripeFeeCents: null,
        stripePaymentIntentId: null,
        providerChargeId: 'cs_def',
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', name: 'Shop One' }] as never);

    const r = await REPORTS.orders.build(ARGS);
    expect(r.rows[0]).toMatchObject({
      taxableAmount: null,
      commissionRate: null,
      stripeFee: null,
      refundStatus: 'NOT_REFUNDED',
      disputeStatus: 'NONE',
    });
  });
});

describe('Phase 2G — disputes report', () => {
  const DISPUTES = [
    {
      amountCents: 3000,
      currency: 'USD',
      reason: 'fraudulent',
      status: 'NEEDS_RESPONSE',
      evidenceDueBy: new Date('2026-09-10T00:00:00Z'),
      createdAt: new Date('2026-08-05T00:00:00Z'),
      store: { name: 'Shop One' },
      order: { orderNumber: 20 },
    },
    {
      amountCents: 1500,
      currency: 'USD',
      reason: 'product_not_received',
      status: 'UNDER_REVIEW',
      evidenceDueBy: null,
      createdAt: new Date('2026-08-06T00:00:00Z'),
      store: { name: 'Shop One' },
      order: { orderNumber: 21 },
    },
    {
      amountCents: 2000,
      currency: 'USD',
      reason: 'duplicate',
      status: 'WON',
      evidenceDueBy: null,
      createdAt: new Date('2026-08-07T00:00:00Z'),
      store: { name: 'Shop Two' },
      order: { orderNumber: 22 },
    },
    {
      amountCents: 500,
      currency: 'USD',
      reason: 'general',
      status: 'LOST',
      evidenceDueBy: null,
      createdAt: new Date('2026-08-08T00:00:00Z'),
      store: { name: 'Shop Two' },
      order: { orderNumber: 23 },
    },
  ];

  it('aggregates each status correctly and computes the at-risk view', async () => {
    prismaMock.dispute.findMany.mockResolvedValue(DISPUTES as never);

    const r = await REPORTS.disputes.build(ARGS);
    expect(r.kpis.find((k) => k.label === 'Total disputes')?.value).toBe('4');
    expect(r.kpis.find((k) => k.label === 'Total disputed')?.value).toBe('$70.00');
    expect(r.kpis.find((k) => k.label === 'Needs response')?.value).toBe('1');
    expect(r.kpis.find((k) => k.label === 'Under review')?.value).toBe('1');
    expect(r.kpis.find((k) => k.label === 'Won')?.value).toBe('1');
    expect(r.kpis.find((k) => k.label === 'Lost')?.value).toBe('1');
    expect(r.kpis.find((k) => k.label === 'Warning closed')?.value).toBe('0');
    // At risk = NEEDS_RESPONSE + UNDER_REVIEW = 2 disputes, $45.00
    expect(r.kpis.find((k) => k.label === 'At risk (needs action)')?.value).toBe('2');
    expect(r.kpis.find((k) => k.label === 'At-risk amount')?.value).toBe('$45.00');
  });

  it('surfaces evidenceDueBy where available and null otherwise', async () => {
    prismaMock.dispute.findMany.mockResolvedValue(DISPUTES as never);
    const r = await REPORTS.disputes.build(ARGS);
    const withDue = r.rows.find((row) => row.order === formatOrderNumber(20));
    expect(withDue?.evidenceDueBy).toBe('2026-09-10T00:00:00.000Z');
    const withoutDue = r.rows.find((row) => row.order === formatOrderNumber(21));
    expect(withoutDue?.evidenceDueBy).toBeNull();
  });

  it('never mutates Order.status or computeBalance-relevant data (read-only — no write call exists in the builder)', async () => {
    prismaMock.dispute.findMany.mockResolvedValue(DISPUTES as never);
    await REPORTS.disputes.build(ARGS);
    expect(prismaMock.order.update).not.toHaveBeenCalled();
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it('empty period returns valid zero-value metrics, not an error', async () => {
    prismaMock.dispute.findMany.mockResolvedValue([] as never);
    const r = await REPORTS.disputes.build(ARGS);
    expect(r.rows).toHaveLength(0);
    expect(r.kpis.find((k) => k.label === 'Total disputes')?.value).toBe('0');
    expect(r.kpis.find((k) => k.label === 'Total disputed')?.value).toBe('$0.00');
  });
});

describe('Phase 2G — reconciliation discrepancies report', () => {
  it('distinguishes PENDING vs EXPIRED discrepancies from FinancialEvent.metadata', async () => {
    prismaMock.financialEvent.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-08-05T00:00:00Z'),
        orderId: 'ord_1',
        storeId: 's1',
        amountCents: 3600,
        currency: 'USD',
        metadata: {
          reason: 'STRIPE_PAID_VENDYLIO_PENDING',
          checkoutSessionId: 'cs_1',
          paymentIntentId: 'pi_1',
          orderStatus: 'PENDING',
        },
      },
      {
        createdAt: new Date('2026-08-06T00:00:00Z'),
        orderId: 'ord_2',
        storeId: 's1',
        amountCents: 1200,
        currency: 'USD',
        metadata: {
          reason: 'STRIPE_PAID_VENDYLIO_EXPIRED',
          checkoutSessionId: 'cs_2',
          paymentIntentId: 'pi_2',
          orderStatus: 'EXPIRED',
        },
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', name: 'Shop One' }] as never);
    prismaMock.order.findMany.mockResolvedValue([
      { id: 'ord_1', orderNumber: 30 },
      { id: 'ord_2', orderNumber: 31 },
    ] as never);

    const r = await REPORTS['reconciliation-discrepancies'].build(ARGS);
    expect(r.kpis.find((k) => k.label === 'Discrepancies')?.value).toBe('2');
    expect(r.kpis.find((k) => k.label === 'Found while PENDING')?.value).toBe('1');
    expect(r.kpis.find((k) => k.label === 'Found while EXPIRED')?.value).toBe('1');
    expect(r.kpis.find((k) => k.label === 'Amount involved')?.value).toBe('$48.00');
    expect(r.rows.find((row) => row.checkoutSessionId === 'cs_1')).toMatchObject({
      orderStatusAtDetection: 'PENDING',
    });
    expect(r.rows.find((row) => row.checkoutSessionId === 'cs_2')).toMatchObject({
      orderStatusAtDetection: 'EXPIRED',
    });
  });

  it('empty period returns valid zero-value metrics', async () => {
    prismaMock.financialEvent.findMany.mockResolvedValue([] as never);
    const r = await REPORTS['reconciliation-discrepancies'].build(ARGS);
    expect(r.rows).toHaveLength(0);
    expect(r.kpis.find((k) => k.label === 'Discrepancies')?.value).toBe('0');
    expect(r.kpis.find((k) => k.label === 'Amount involved')?.value).toBe('$0.00');
  });
});

describe('Phase 2G — financial event explorer', () => {
  it('filters strictly by eventType, provider, sourceType, sourceId and orderId', async () => {
    prismaMock.financialEvent.findMany.mockResolvedValue([] as never);
    await REPORTS['financial-events'].build({
      ...ARGS,
      eventType: 'STRIPE_FEE_RECORDED',
      provider: 'stripe',
      sourceType: 'Order',
      sourceId: 'order-9',
      orderId: 'order-9',
    });
    expect(prismaMock.financialEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventType: 'STRIPE_FEE_RECORDED',
          provider: 'stripe',
          sourceType: 'Order',
          sourceId: 'order-9',
          orderId: 'order-9',
        }),
      }),
    );
  });

  it('is an audit view only — never writes, and correctly nets signed amounts', async () => {
    prismaMock.financialEvent.findMany.mockResolvedValue([
      {
        id: 'fe1',
        eventType: 'PAYMENT_SUCCEEDED',
        sourceType: 'Order',
        sourceId: 'o1',
        storeId: 's1',
        orderId: 'o1',
        amountCents: 3600,
        currency: 'USD',
        provider: 'stripe_platform',
        externalId: 'pi_1',
        createdAt: new Date('2026-08-05T00:00:00Z'),
      },
      {
        id: 'fe2',
        eventType: 'STRIPE_FEE_RECORDED',
        sourceType: 'Order',
        sourceId: 'o1',
        storeId: 's1',
        orderId: 'o1',
        amountCents: -135,
        currency: 'USD',
        provider: 'stripe',
        externalId: 'txn_1',
        createdAt: new Date('2026-08-05T00:00:01Z'),
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', name: 'Shop One' }] as never);
    prismaMock.order.findMany.mockResolvedValue([{ id: 'o1', orderNumber: 40 }] as never);

    const r = await REPORTS['financial-events'].build(ARGS);
    expect(r.kpis.find((k) => k.label === 'Net amount')?.value).toBe('$34.65');
    expect(prismaMock.order.update).not.toHaveBeenCalled();
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('only offers the eventTypes the architecture actually writes — not the full aspirational list', async () => {
    const { KNOWN_FINANCIAL_EVENT_TYPES } = await import('./builders/financialEvents');
    expect(KNOWN_FINANCIAL_EVENT_TYPES).not.toContain('PAYMENT_CREATED');
    expect(KNOWN_FINANCIAL_EVENT_TYPES).not.toContain('PAYOUT_PAID');
    expect(KNOWN_FINANCIAL_EVENT_TYPES).toContain('PAYMENT_SUCCEEDED');
    expect(KNOWN_FINANCIAL_EVENT_TYPES).toContain('RECONCILIATION_DISCREPANCY');
  });
});

describe('Phase 2G — CommissionCharge status reporting (commission-receivables)', () => {
  it('reports OWED, INVOICED, SETTLED and WAIVED separately without recreating the ledger', async () => {
    prismaMock.commissionCharge.findMany.mockResolvedValue([
      { storeId: 's1', amountCents: 500, status: 'OWED', createdAt: new Date() },
      { storeId: 's1', amountCents: 200, status: 'INVOICED', createdAt: new Date() },
      { storeId: 's1', amountCents: 900, status: 'SETTLED', createdAt: new Date() },
      { storeId: 's1', amountCents: 150, status: 'WAIVED', createdAt: new Date() },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', name: 'Shop One' }] as never);

    const r = await REPORTS['commission-receivables'].build(ARGS);
    expect(r.kpis.find((k) => k.label === 'Total owed')?.value).toBe('$5.00');
    expect(r.kpis.find((k) => k.label === 'Invoiced (awaiting)')?.value).toBe('$2.00');
    expect(r.kpis.find((k) => k.label === 'Settled (all-time)')?.value).toBe('$9.00');
    expect(r.kpis.find((k) => k.label === 'Waived (all-time)')?.value).toBe('$1.50');
    // SETTLED/WAIVED are resolved — never counted into the outstanding row.
    expect(r.rows[0]).toMatchObject({ owed: 500, invoiced: 200 });
  });
});

describe('Phase 2G — payout state aggregation (payouts)', () => {
  it('correctly classifies PENDING/PROCESSING/COMPLETED/FAILED/CANCELLED withdrawals', async () => {
    prismaMock.withdrawal.findMany.mockResolvedValue([
      {
        userId: 'u1',
        amount: 1000,
        commissionSettledCents: 100,
        status: 'COMPLETED',
        destination: { method: 'CASH_APP', cashtag: '$shop' },
        requestedAt: new Date('2026-08-01T00:00:00Z'),
        completedAt: new Date('2026-08-02T00:00:00Z'),
        user: { email: 'seller@example.com' },
      },
      {
        userId: 'u1',
        amount: 500,
        commissionSettledCents: 0,
        status: 'PENDING',
        destination: { method: 'ZELLE', contact: 'seller@example.com' },
        requestedAt: new Date('2026-08-03T00:00:00Z'),
        completedAt: null,
        user: { email: 'seller@example.com' },
      },
      {
        userId: 'u1',
        amount: 300,
        commissionSettledCents: 0,
        status: 'PROCESSING',
        destination: { method: 'BANK' },
        requestedAt: new Date('2026-08-04T00:00:00Z'),
        completedAt: null,
        user: { email: 'seller@example.com' },
      },
      {
        userId: 'u1',
        amount: 200,
        commissionSettledCents: 0,
        status: 'FAILED',
        destination: { method: 'BANK' },
        requestedAt: new Date('2026-08-05T00:00:00Z'),
        completedAt: null,
        user: { email: 'seller@example.com' },
      },
      {
        userId: 'u1',
        amount: 150,
        commissionSettledCents: 0,
        status: 'CANCELLED',
        destination: { method: 'BANK' },
        requestedAt: new Date('2026-08-06T00:00:00Z'),
        completedAt: null,
        user: { email: 'seller@example.com' },
      },
    ] as never);

    const r = await REPORTS.payouts.build(ARGS);
    // net paid (COMPLETED only) = 1000 - 100 = 900
    expect(r.kpis.find((k) => k.label === 'Net paid (completed)')?.value).toBe('$9.00');
    // pending liability (PENDING + PROCESSING gross) = 500 + 300 = 800
    expect(r.kpis.find((k) => k.label === 'Pending liability')?.value).toBe('$8.00');
    // commission recovered (COMPLETED only) = 100
    expect(r.kpis.find((k) => k.label === 'Commission recovered')?.value).toBe('$1.00');
    expect(r.rows).toHaveLength(5);
  });
});

describe('Phase 2G — date boundaries', () => {
  it('from is inclusive, to is exclusive — matches every other date-ranged report’s convention', async () => {
    prismaMock.financialEvent.findMany.mockResolvedValue([] as never);
    await REPORTS['reconciliation-discrepancies'].build(ARGS);
    expect(prismaMock.financialEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: ARGS.from, lt: ARGS.to },
        }),
      }),
    );
  });
});

describe('format helpers', () => {
  it('formatCell renders by column format', () => {
    expect(formatCell(1234, 'usd')).toBe('$12.34');
    expect(formatCell(4.25, 'percent')).toBe('4.3%');
    expect(formatCell(null, 'usd')).toBe('—');
    expect(formatCell('hi')).toBe('hi');
  });
  it('periodLabel shows the last included day', () => {
    expect(periodLabel(new Date('2026-08-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'))).toMatch(
      /Aug 1.*Aug 31, 2026/,
    );
  });
});
