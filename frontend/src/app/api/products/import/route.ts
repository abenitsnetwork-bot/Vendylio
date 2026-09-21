// POST /api/products/import — bulk-create products from a CSV file for the
// caller's store. All-or-nothing: every row is validated before anything is
// written, so a bad row never leaves a half-imported catalog to clean up.
// A category named in the CSV that doesn't exist yet is created (matched
// case/whitespace-insensitively against existing categories first).
export const runtime = 'nodejs';
export const maxDuration = 60;

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { slugify, ensureUniqueSlug } from '@/lib/server/slug';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { parseProductImportCsv, type ImportedProductRow } from '@/lib/server/products/importCsv';

const Body = z.object({
  csv: z.string().min(1, 'The file is empty.').max(5_000_000, 'File is too large (max 5MB).'),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'Create a store before importing products.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const parsedBody = Body.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsedBody.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const { rows, errors } = parseProductImportCsv(parsedBody.data.csv);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'IMPORT_VALIDATION_FAILED', rowErrors: errors },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // Resolve every distinct category name to an id, creating any that
    // don't exist yet. Done ahead of the product-creation transaction — if
    // something below fails, a newly-created empty category is a harmless
    // leftover the seller can delete, not a data-integrity problem.
    const existingCategories = await prisma.category.findMany({
      where: { storeId: store.id },
      select: { id: true, name: true, sortOrder: true },
    });
    const categoryIdByName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c.id]));
    let nextSortOrder = existingCategories.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;

    const distinctNames = [
      ...new Set(rows.map((r) => r.category).filter((c): c is string => Boolean(c))),
    ];
    let categoriesCreated = 0;
    for (const name of distinctNames) {
      if (categoryIdByName.has(name.toLowerCase())) continue;
      const sortOrder = nextSortOrder;
      nextSortOrder += 1;
      let createdId: string | null = null;
      await ensureUniqueSlug(slugify(name) || 'category', async (candidate) => {
        const created = await prisma.category.create({
          data: { storeId: store.id, name, slug: candidate, sortOrder },
        });
        createdId = created.id;
      });
      categoryIdByName.set(name.toLowerCase(), createdId!);
      categoriesCreated += 1;
    }

    const productData = rows.map((r: ImportedProductRow) => ({
      storeId: store.id,
      name: r.name,
      priceCents: r.priceCents,
      quantity: r.quantity,
      unit: r.unit,
      status: r.status,
      ...(r.category ? { categoryId: categoryIdByName.get(r.category.toLowerCase())! } : {}),
      ...(r.lowStockThreshold !== undefined ? { lowStockThreshold: r.lowStockThreshold } : {}),
      ...(r.description ? { description: r.description } : {}),
      ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}),
    }));

    const created = await prisma.$transaction(
      async (tx) => {
        const createdProducts = await tx.product.createManyAndReturn({ data: productData });
        await tx.stockMovement.createMany({
          data: createdProducts.map((p) => ({
            storeId: store.id,
            productId: p.id,
            delta: p.quantity,
            resultingQuantity: p.quantity,
            reason: 'CORRECTION',
            note: 'Opening balance (CSV import)',
            actorType: 'SELLER',
          })),
        });
        return createdProducts;
      },
      { timeout: 30_000 },
    );

    return NextResponse.json(
      { created: created.length, categoriesCreated },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
