// GET  /api/categories — the caller's own store categories, ordered.
// POST /api/categories — add a category to the caller's store.
//
// Per-store, seller-managed (replaced the old hard-coded Product.category
// enum). Slug is unique per store and used as the storefront section anchor.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { slugify, ensureUniqueSlug } from '@/lib/server/slug';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  name: z.string().trim().min(1).max(60),
});

function noStore(requestId: string): NextResponse {
  return NextResponse.json(
    { error: 'NO_STORE', message: 'Create a store before managing categories.' },
    { status: 404, headers: { 'x-request-id': requestId } },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) return noStore(ctx.requestId);

    const categories = await prisma.category.findMany({
      where: { storeId: store.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        sortOrder: true,
        _count: { select: { products: true } },
      },
    });

    return NextResponse.json(
      {
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          sortOrder: c.sortOrder,
          productCount: c._count.products,
        })),
      },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) return noStore(ctx.requestId);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const last = await prisma.category.findFirst({
      where: { storeId: store.id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const nextSortOrder = (last?.sortOrder ?? -1) + 1;

    let created: Awaited<ReturnType<typeof prisma.category.create>> | null = null;
    await ensureUniqueSlug(slugify(parsed.data.name) || 'category', async (candidate) => {
      created = await prisma.category.create({
        data: {
          storeId: store.id,
          name: parsed.data.name,
          slug: candidate,
          sortOrder: nextSortOrder,
        },
      });
    });

    const c = created!;
    return NextResponse.json(
      {
        category: { id: c.id, name: c.name, slug: c.slug, sortOrder: c.sortOrder, productCount: 0 },
      },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
