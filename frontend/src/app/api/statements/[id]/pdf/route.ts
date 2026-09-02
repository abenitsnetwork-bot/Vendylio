// GET /api/statements/[id]/pdf — the payout statement as a PDF download.
//
// OWNER-only. The PDF is rendered on demand from the frozen
// WithdrawalStatement.data snapshot (deterministic — nothing binary is
// stored). Navigated to directly via an <a href> in the dashboard, so auth
// is the session cookie, not the api() wrapper.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { requireStoreOwner } from '@/lib/server/team/owner-guard';
import { renderStatementPdf } from '@/lib/server/statements/pdf';
import type { StatementData } from '@/lib/server/statements/types';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'Create a store first.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const ownerGate = await requireStoreOwner(
      store,
      reqCtx.requestId,
      'Only the store owner can download payout statements.',
    );
    if (ownerGate) return ownerGate;

    const { id } = await ctx.params;
    const row = await prisma.withdrawalStatement.findUnique({
      where: { id },
      select: { storeId: true, data: true, periodTo: true },
    });
    // 404 (not 403) when it belongs to another store — don't confirm it exists.
    if (!row || row.storeId !== store.id) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Statement not found.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const data = row.data as unknown as StatementData;
    const pdf = await renderStatementPdf(data);
    const filename = `vendylio-statement-${row.periodTo.toISOString().slice(0, 10)}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'private, no-store',
        'x-request-id': reqCtx.requestId,
      },
    });
  });
}
