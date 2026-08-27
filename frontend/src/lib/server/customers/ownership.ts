// Shared ownership resolver for customer.storeId === callerStore.id checks —
// same 404-not-403 pattern as findOwnedOrder / findOwnedProduct: a seller
// probing another seller's customer id gets CUSTOMER_NOT_FOUND, never a 403
// that would confirm the id exists.
import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import type { Customer, Store } from '@prisma/client';

export async function findOwnedCustomer(
  userId: string,
  customerId: string,
): Promise<{ store: Store | null; customer: Customer | null }> {
  const store = await resolveOwnStore(userId);
  if (!store) return { store: null, customer: null };
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, storeId: store.id },
  });
  return { store, customer };
}
