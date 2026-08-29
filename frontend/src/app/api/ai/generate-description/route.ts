// POST /api/ai/generate-description — Phase 11. Powers the "Generate with
// AI" button in ProductForm.tsx and the onboarding business step. Auth-only (no
// ownership check): the model never touches a stored row, it only sees the
// handful of fields already visible in the caller's own form, so there is
// nothing here to scope to a particular product/store id.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { AiNotConfiguredError, generateDescription } from '@/lib/server/ai/generate-description';
import { enforceAiRateLimit } from '@/lib/server/ai/rate-limit';
import { PRODUCT_CATEGORY_VALUES } from '@/lib/productCategories';
import { PRODUCT_UNIT_VALUES } from '@/lib/productUnits';

const Body = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('product'),
    name: z.string().trim().min(1).max(120),
    category: z.enum(PRODUCT_CATEGORY_VALUES).optional(),
    unit: z.enum(PRODUCT_UNIT_VALUES).optional(),
  }),
  z.object({
    kind: z.literal('store'),
    name: z.string().trim().min(1).max(120),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
  }),
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAiRateLimit(auth.user.sub);
    if (limited) return limited;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    try {
      const description = await generateDescription(parsed.data);
      return NextResponse.json({ description }, { headers: { 'x-request-id': ctx.requestId } });
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        return NextResponse.json(
          { error: 'AI_NOT_CONFIGURED', message: 'AI generation is not configured.' },
          { status: 503, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      return NextResponse.json(
        { error: 'AI_GENERATION_FAILED', message: 'Could not generate a description.' },
        { status: 502, headers: { 'x-request-id': ctx.requestId } },
      );
    }
  });
}
