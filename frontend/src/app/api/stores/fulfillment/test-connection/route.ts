// POST /api/stores/fulfillment/test-connection — a SAFE credential probe for
// the merchant "Test connection" button. Body: { provider: "UBER_DIRECT" | "DOORDASH" }.
//
// Delegates to the provider adapter's `testConnection()`, which authenticates
// and stops — it MUST NEVER create a quote or a delivery, so it can never
// dispatch a real driver (spec §287/§288).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { getDeliveryProvider } from '@/lib/server/fulfillment/registry';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({ provider: z.enum(['UBER_DIRECT', 'DOORDASH']) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'STORE_NOT_FOUND', message: 'You have no store yet.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const result = await getDeliveryProvider(parsed.data.provider).testConnection();
    return NextResponse.json(result, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
