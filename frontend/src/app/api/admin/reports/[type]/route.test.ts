import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireSuperadmin: vi.fn() }));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({ enforceAdminRateLimit: vi.fn() }));

const build = vi.fn();
vi.mock('@/lib/server/reports/registry', () => ({
  isReportType: (v: string) => v === 'payouts',
  REPORTS: {
    payouts: {
      type: 'payouts',
      usesStoreFilter: true,
      usesDateRange: true,
      build: (...a: unknown[]) => build(...a),
    },
  },
}));
vi.mock('@/lib/server/reports/csv', () => ({ reportToCsv: () => 'CSV_BODY' }));
vi.mock('@/lib/server/reports/pdf', () => ({
  renderReportPdf: async () => Buffer.from('%PDF-1.4 fake'),
}));

import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { seedSuperadmin } from '@/test-utils/admin-fixtures';
import { GET } from './route';

const mockAuth = vi.mocked(requireSuperadmin);
const mockRate = vi.mocked(enforceAdminRateLimit);

const sa = seedSuperadmin({ id: 'sa_1' });
const saCtx = {
  user: { sub: sa.id, email: sa.email },
  admin: { id: sa.id, email: sa.email, role: 'SUPERADMIN' as const },
};

const REPORT = {
  type: 'payouts',
  title: 'Payouts',
  period: { from: 'x', to: 'y', label: 'Aug 2026' },
  generatedAt: '2026-09-01T00:00:00.000Z',
  kpis: [],
  columns: [{ key: 'store', label: 'Store' }],
  rows: [],
};

function req(qs = '') {
  return new NextRequest(`http://test/api/admin/reports/payouts${qs}`);
}
const params = (type: string) => ({ params: Promise.resolve({ type }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(saCtx as never);
  mockRate.mockResolvedValue(null);
  build.mockResolvedValue(REPORT);
});

describe('GET /api/admin/reports/[type]', () => {
  it('403s a non-superadmin', async () => {
    mockAuth.mockResolvedValue(NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) as never);
    expect((await GET(req(), params('payouts'))).status).toBe(403);
  });

  it('404s an unknown report type', async () => {
    expect((await GET(req(), params('bogus'))).status).toBe(404);
  });

  it('preview returns the ReportData JSON', async () => {
    const res = await GET(req('?format=preview'), params('payouts'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ type: 'payouts', title: 'Payouts' });
  });

  it('csv returns a text/csv attachment', async () => {
    const res = await GET(req('?format=csv'), params('payouts'));
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(await res.text()).toBe('CSV_BODY');
  });

  it('pdf returns an application/pdf attachment', async () => {
    const res = await GET(req('?format=pdf'), params('payouts'));
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(
      Buffer.from(await res.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
  });

  it('rejects an inverted range', async () => {
    const res = await GET(
      req('?from=2026-09-01T00:00:00Z&to=2026-08-01T00:00:00Z'),
      params('payouts'),
    );
    expect(res.status).toBe(400);
  });

  it('passes from/to/storeId through to the builder', async () => {
    await GET(
      req('?from=2026-08-01T00:00:00Z&to=2026-08-31T00:00:00Z&storeId=s1&format=preview'),
      params('payouts'),
    );
    const arg = build.mock.calls[0]?.[0];
    expect(arg.storeId).toBe('s1');
    expect(arg.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});
