import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, type Mock } from 'vitest';

// Prisma's groupBy has an overloaded signature that mockDeep's types don't
// expose `.mockResolvedValue` on — same helper the pulse route test uses.
const groupByMock = (m: unknown) => m as unknown as Mock;

import { REPORTS, REPORT_LIST, isReportType } from './registry';
import { reportToCsv } from './csv';
import { renderReportPdf } from './pdf';
import { formatCell, periodLabel } from './format';
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
  prismaMock.user.findMany.mockResolvedValue([] as never);
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
