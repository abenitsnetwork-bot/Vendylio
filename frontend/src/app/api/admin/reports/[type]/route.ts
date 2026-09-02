// GET /api/admin/reports/[type]?from=&to=&storeId=&format=preview|csv|pdf
//
// One handler for every report — the registry maps `type` to a builder that
// returns the shared ReportData shape, then `format` picks the serializer
// (JSON preview / CSV / PDF). SUPERADMIN only.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { REPORTS, isReportType } from '@/lib/server/reports/registry';
import { reportToCsv } from '@/lib/server/reports/csv';
import { renderReportPdf } from '@/lib/server/reports/pdf';

const MAX_RANGE_MS = 800 * 24 * 60 * 60 * 1000; // ~26 months

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ type: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { type } = await ctx.params;
    if (!isReportType(type)) {
      return NextResponse.json(
        { error: 'UNKNOWN_REPORT', message: 'No such report.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    const def = REPORTS[type];

    const url = req.nextUrl;
    const format = url.searchParams.get('format') ?? 'preview';
    if (!['preview', 'csv', 'pdf'].includes(format)) {
      return NextResponse.json(
        { error: 'BAD_FORMAT', message: 'format must be preview, csv or pdf.' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const now = new Date();
    const to = parseDate(url.searchParams.get('to')) ?? now;
    const from = parseDate(url.searchParams.get('from')) ?? startOfMonthUtc(to);
    if (from >= to) {
      return NextResponse.json(
        { error: 'BAD_RANGE', message: 'from must be before to.' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      return NextResponse.json(
        { error: 'RANGE_TOO_WIDE', message: 'Keep the range under ~2 years.' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const storeId = url.searchParams.get('storeId') || undefined;

    const report = await def.build({
      from,
      to,
      storeId: def.usesStoreFilter ? storeId : undefined,
    });

    if (format === 'csv') {
      return new NextResponse(reportToCsv(report), {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${type}-${to.toISOString().slice(0, 10)}.csv"`,
          'cache-control': 'private, no-store',
          'x-request-id': reqCtx.requestId,
        },
      });
    }
    if (format === 'pdf') {
      const pdf = await renderReportPdf(report);
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${type}-${to.toISOString().slice(0, 10)}.pdf"`,
          'cache-control': 'private, no-store',
          'x-request-id': reqCtx.requestId,
        },
      });
    }

    return NextResponse.json(report, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
