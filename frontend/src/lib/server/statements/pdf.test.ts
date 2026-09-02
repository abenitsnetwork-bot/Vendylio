import { describe, it, expect } from 'vitest';
import { renderStatementPdf } from './pdf';
import type { StatementData } from './types';

const SAMPLE: StatementData = {
  schemaVersion: 1,
  storeName: 'Ako International Market',
  storeSlug: 'ako-international-market',
  currency: 'USD',
  periodFrom: '2026-02-01T00:00:00.000Z',
  periodTo: '2026-03-02T12:00:00.000Z',
  generatedAt: '2026-03-02T12:00:05.000Z',
  sales: [
    {
      provider: 'stripe_platform',
      label: 'Card — held & paid out by Vendylio',
      settlement: 'vendylio',
      orderCount: 3,
      grossCents: 12000,
      commissionCents: 600,
      netCents: 11400,
    },
    {
      provider: 'cashapp_manual',
      label: 'Cash App — received directly',
      settlement: 'seller_direct',
      orderCount: 1,
      grossCents: 4000,
      commissionCents: 200,
      netCents: 3800,
    },
  ],
  salesTotals: { orderCount: 4, grossCents: 16000, commissionCents: 800, netCents: 15200 },
  refunds: { orderCount: 1, amountCents: 1200 },
  taxCents: 0,
  payout: {
    withdrawalId: 'wd-1',
    method: 'Cash App $cashdo21',
    status: 'COMPLETED',
    requestedAt: '2026-03-01T10:00:00.000Z',
    completedAt: '2026-03-02T12:00:00.000Z',
    grossCents: 8500,
    commissionWithheldCents: 350,
    commissionLines: [
      {
        orderNumber: 'VND-10042',
        kind: 'SALE',
        accruedAt: '2026-02-10T00:00:00.000Z',
        amountCents: 200,
      },
      {
        orderNumber: 'VND-10051',
        kind: 'SALE',
        accruedAt: '2026-02-20T00:00:00.000Z',
        amountCents: 150,
      },
    ],
    netPayableCents: 8150,
  },
};

describe('renderStatementPdf', () => {
  it('produces a non-trivial PDF buffer', async () => {
    const buf = await renderStatementPdf(SAMPLE);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('handles an empty period (no sales, no commission lines)', async () => {
    const empty: StatementData = {
      ...SAMPLE,
      sales: [],
      salesTotals: { orderCount: 0, grossCents: 0, commissionCents: 0, netCents: 0 },
      refunds: { orderCount: 0, amountCents: 0 },
      payout: { ...SAMPLE.payout, commissionWithheldCents: 0, commissionLines: [] },
    };
    const buf = await renderStatementPdf(empty);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
