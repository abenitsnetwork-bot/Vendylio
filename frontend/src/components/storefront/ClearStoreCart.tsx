'use client';

import { useEffect } from 'react';

/**
 * Empties this store's cart once, on mount. Rendered only on the order
 * success page — NOT on checkout redirect. The buyer's cart must survive the
 * trip to Stripe's hosted page (they might cancel and come back to retry via
 * /failed → "Try Again"), so the cart is cleared only after we've landed on a
 * real order confirmation. Reaching this page again later just no-ops.
 */
export function ClearStoreCart({ storeSlug }: { storeSlug: string }) {
  useEffect(() => {
    try {
      localStorage.removeItem(`vendylio-cart:${storeSlug}`);
    } catch {
      // Storage unavailable (private mode) — nothing to clear.
    }
  }, [storeSlug]);
  return null;
}
