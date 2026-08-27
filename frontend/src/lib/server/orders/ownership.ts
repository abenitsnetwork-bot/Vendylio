// Shared ownership resolver for order.storeId === callerStore.id checks —
// used by both api/orders/[id]/route.ts and api/orders/[id]/delivery/route.ts
// so the two routes can't drift on what "owns this order" means. 404-not-403
// on mismatch, same pattern as findOwnedProduct in api/products/[id]/route.ts.
import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import type { Order, Store } from '@prisma/client';

export async function findOwnedOrder(
  userId: string,
  orderId: string,
): Promise<{ store: Store | null; order: Order | null }> {
  const store = await resolveOwnStore(userId);
  if (!store) return { store: null, order: null };
  const order = await prisma.order.findFirst({ where: { id: orderId, storeId: store.id } });
  return { store, order };
}
