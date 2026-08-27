// Shared ownership resolver for product.storeId === callerStore.id checks —
// used by api/products/[id]/route.ts and the Phase 7 variant routes
// (api/products/[id]/variants/**) so they can't drift on what "owns this
// product" means. 404-not-403 on mismatch, same pattern as findOwnedOrder /
// findOwnedCustomer.
import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import type { Product, Store } from '@prisma/client';

export async function findOwnedProduct(
  userId: string,
  productId: string,
): Promise<{ store: Store | null; product: Product | null }> {
  const store = await resolveOwnStore(userId);
  if (!store) return { store: null, product: null };
  const product = await prisma.product.findFirst({
    where: { id: productId, storeId: store.id },
  });
  return { store, product };
}
