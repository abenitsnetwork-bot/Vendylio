// PATCH  /api/categories/[id] — rename / reorder one of the caller's categories.
// DELETE /api/categories/[id] — remove it; its products fall back to
//   "Uncategorized" (categoryId = null) rather than blocking the delete.
//
// Ownership is checked via the category's storeId matching the caller's
// store — a 404 (not 403) on a mismatch so a seller can't probe another
// store's category ids.
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

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const PatchBody = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((d) => d.name !== undefined || d.sortOrder !== undefined, {
    message: 'Nothing to update.',
  });

async function findOwnedCategory(userId: string, categoryId: string) {
  const store = await resolveOwnStore(userId);
  if (!store) return { store: null, category: null };
  const category = await prisma.category.findFirst({
    where: { id: categoryId, storeId: store.id },
  });
  return { store, category };
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    const { store, category } = await findOwnedCategory(auth.user.sub, id);
    if (!store || !category) {
      return NextResponse.json(
        { error: 'CATEGORY_NOT_FOUND', message: 'No such category.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    let updated = category;
    const nextName = parsed.data.name;
    if (nextName !== undefined && nextName !== category.name) {
      // Updating a row's slug to its own current value is a no-op for the
      // unique constraint, so a rename that resolves to the same slug just
      // succeeds; a clash with a *different* category throws P2002 and
      // ensureUniqueSlug retries with a numeric suffix.
      await ensureUniqueSlug(slugify(nextName) || 'category', async (candidate) => {
        updated = await prisma.category.update({
          where: { id: category.id },
          data: { name: nextName, slug: candidate },
        });
      });
    }
    if (parsed.data.sortOrder !== undefined) {
      updated = await prisma.category.update({
        where: { id: category.id },
        data: { sortOrder: parsed.data.sortOrder },
      });
    }

    return NextResponse.json(
      {
        category: {
          id: updated.id,
          name: updated.name,
          slug: updated.slug,
          sortOrder: updated.sortOrder,
        },
      },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    const { store, category } = await findOwnedCategory(auth.user.sub, id);
    if (!store || !category) {
      return NextResponse.json(
        { error: 'CATEGORY_NOT_FOUND', message: 'No such category.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // Re-parent products then delete, atomically. (The FK is ON DELETE SET
    // NULL too, but doing it explicitly keeps the reassignment intentional
    // and lets us return the affected count.)
    const [{ count }] = await prisma.$transaction([
      prisma.product.updateMany({
        where: { categoryId: category.id },
        data: { categoryId: null },
      }),
      prisma.category.delete({ where: { id: category.id } }),
    ]);

    return NextResponse.json(
      { ok: true, productsReassigned: count },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
