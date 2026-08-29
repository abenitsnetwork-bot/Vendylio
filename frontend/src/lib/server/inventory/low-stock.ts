// Phase 4 — low-stock detection queries.
//
// The "effective threshold" of a product/variant is
// `Product.lowStockThreshold ?? Store.defaultLowStockThreshold`, which
// can't be expressed as a plain Prisma `where` (no column-to-column
// comparison), so both helpers here drop to raw SQL with a COALESCE.
//
// `sweepLowStock` is the safety net behind markPaid.ts's inline alert: it
// catches products pushed below threshold by a manual inventory adjustment,
// a bulk edit, or a missed enqueue. It only enqueues rows whose
// `lowStockNotifiedAt` is still null, so it never double-alerts an episode
// markPaid already reported.
//
// `countLowStock` powers the dashboard "N to restock" badge (GET
// /api/stores/me).
import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { enqueueOutbox } from '@/lib/server/outbox';

interface SweepRow {
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  threshold: number;
  ownerId: string;
}

export interface SweepLowStockOptions {
  prisma: PrismaClient;
  /** Safety cap on rows processed per tick. Default 500. */
  limit?: number;
}

export async function sweepLowStock(
  opts: SweepLowStockOptions,
): Promise<{ scanned: number; enqueued: number }> {
  const limit = opts.limit ?? 500;

  const rows = await opts.prisma.$queryRaw<SweepRow[]>`
    SELECT p."id"        AS "productId",
           NULL::text    AS "variantId",
           p."name"      AS "productName",
           NULL::text    AS "variantLabel",
           p."quantity"  AS "quantity",
           COALESCE(p."lowStockThreshold", s."defaultLowStockThreshold") AS "threshold",
           o."ownerId"   AS "ownerId"
    FROM "Product" p
    JOIN "Store" s ON s."id" = p."storeId"
    JOIN "Organization" o ON o."id" = s."organizationId"
    WHERE p."lowStockNotifiedAt" IS NULL
      AND p."status" = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id")
      AND p."quantity" <= COALESCE(p."lowStockThreshold", s."defaultLowStockThreshold")
    UNION ALL
    SELECT v."productId"                 AS "productId",
           v."id"                        AS "variantId",
           p."name"                      AS "productName",
           (v."name" || ' / ' || v."value") AS "variantLabel",
           v."quantity"                  AS "quantity",
           COALESCE(p."lowStockThreshold", s."defaultLowStockThreshold") AS "threshold",
           o."ownerId"                   AS "ownerId"
    FROM "ProductVariant" v
    JOIN "Product" p ON p."id" = v."productId"
    JOIN "Store" s ON s."id" = p."storeId"
    JOIN "Organization" o ON o."id" = s."organizationId"
    WHERE v."lowStockNotifiedAt" IS NULL
      AND p."status" = 'ACTIVE'
      AND v."quantity" <= COALESCE(p."lowStockThreshold", s."defaultLowStockThreshold")
    LIMIT ${limit}
  `;

  const detectedAt = new Date().toISOString();
  let enqueued = 0;

  for (const row of rows) {
    const base = {
      userId: row.ownerId,
      productId: row.productId,
      variantId: row.variantId,
      productName: row.productName,
      variantLabel: row.variantLabel,
      detectedAt,
    };
    if (row.quantity <= 0) {
      await enqueueOutbox(opts.prisma, { kind: 'notification.out_of_stock', payload: base });
    } else {
      await enqueueOutbox(opts.prisma, {
        kind: 'notification.low_stock',
        payload: { ...base, quantity: row.quantity, threshold: row.threshold },
      });
    }
    enqueued++;
  }

  return { scanned: rows.length, enqueued };
}

/**
 * Count of a store's products/variants at or below their effective
 * threshold, split into "low" (still > 0) and "out" (<= 0).
 */
export async function countLowStock(
  prisma: PrismaClient,
  storeId: string,
): Promise<{ lowStockCount: number; outOfStockCount: number }> {
  const [row] = await prisma.$queryRaw<{ low: number; out: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE x."q" > 0 AND x."q" <= x."t")::int AS "low",
      COUNT(*) FILTER (WHERE x."q" <= 0)::int                   AS "out"
    FROM (
      SELECT p."quantity" AS "q",
             COALESCE(p."lowStockThreshold", s."defaultLowStockThreshold") AS "t"
      FROM "Product" p
      JOIN "Store" s ON s."id" = p."storeId"
      WHERE p."storeId" = ${storeId}
        AND p."status" = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."productId" = p."id")
      UNION ALL
      SELECT v."quantity" AS "q",
             COALESCE(p."lowStockThreshold", s."defaultLowStockThreshold") AS "t"
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
      JOIN "Store" s ON s."id" = p."storeId"
      WHERE p."storeId" = ${storeId}
        AND p."status" = 'ACTIVE'
    ) x
  `;
  return {
    lowStockCount: row?.low ?? 0,
    outOfStockCount: row?.out ?? 0,
  };
}
