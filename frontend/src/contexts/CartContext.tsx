'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { roundQuantity } from '@/lib/quantity';

export interface CartItem {
  productId: string;
  name: string;
  priceCents: number;
  imageUrl: string | null;
  quantity: number;
  /** Stock snapshot from the moment the item was added — caps the stepper. */
  maxQuantity: number;
  unit: string;
  /** Phase 7 — set when the buyer picked a variant (e.g. "Size: Large").
   * Two different variants of the same product are two different cart
   * lines, so `addItem`/`removeItem`/`setQuantity` key on (productId,
   * variantId) together, not productId alone. */
  variantId?: string;
  variantLabel?: string;
}

export interface AddableProduct {
  id: string;
  name: string;
  priceCents: number;
  imageUrl: string | null;
  quantity: number;
  unit: string;
  variantId?: string;
  variantLabel?: string;
}

interface CartContextValue {
  items: CartItem[];
  itemCount: number;
  subtotalCents: number;
  /** `qty` defaults to 1 (the existing "tap to add one" behavior) — the
   * product-detail page's quantity stepper passes an explicit amount. */
  addItem: (product: AddableProduct, qty?: number) => void;
  removeItem: (productId: string, variantId?: string) => void;
  setQuantity: (productId: string, quantity: number, variantId?: string) => void;
  clear: () => void;
}

function sameLine(item: CartItem, productId: string, variantId?: string): boolean {
  return item.productId === productId && item.variantId === variantId;
}

const CartContext = createContext<CartContextValue | null>(null);

/**
 * One cart per storefront (`storeSlug`), stored in localStorage. Customers
 * aren't Vendylio accounts, so there's no server-side cart — this is the
 * simplest correct scope: a customer browsing two stores in two tabs gets
 * two independent carts, and a reload keeps the cart they were building.
 */
export function CartProvider({ storeSlug, children }: { storeSlug: string; children: ReactNode }) {
  const storageKey = `vendylio-cart:${storeSlug}`;
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as CartItem[];
        // A cart built before Phase 7 shipped `unit` has no such field in
        // localStorage — default it to 'UNIT' (the whole-count behavior
        // that existed before weight-based products) rather than crashing
        // downstream on `item.unit.toLowerCase()`.
        setItems(parsed.map((item) => ({ ...item, unit: item.unit || 'UNIT' })));
      }
    } catch {
      // Corrupt or inaccessible storage — start with an empty cart.
    } finally {
      setHydrated(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      // Storage full or unavailable (private browsing) — cart still works
      // in-memory for the rest of the session.
    }
  }, [items, hydrated, storageKey]);

  const addItem = useCallback((product: AddableProduct, qty: number = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => sameLine(i, product.id, product.variantId));
      if (existing) {
        const nextQty = Math.min(existing.quantity + qty, product.quantity);
        return prev.map((i) =>
          sameLine(i, product.id, product.variantId) ? { ...i, quantity: nextQty } : i,
        );
      }
      if (product.quantity <= 0) return prev;
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          priceCents: product.priceCents,
          imageUrl: product.imageUrl,
          quantity: Math.min(qty, product.quantity),
          maxQuantity: product.quantity,
          unit: product.unit,
          ...(product.variantId ? { variantId: product.variantId } : {}),
          ...(product.variantLabel ? { variantLabel: product.variantLabel } : {}),
        },
      ];
    });
  }, []);

  const removeItem = useCallback((productId: string, variantId?: string) => {
    setItems((prev) => prev.filter((i) => !sameLine(i, productId, variantId)));
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number, variantId?: string) => {
    setItems((prev) =>
      prev
        .map((i) => {
          if (!sameLine(i, productId, variantId)) return i;
          // A UNIT line stays a whole count (floor 1); a weight-unit line
          // (KG/LB/G/OZ) allows fine-grained fractional amounts like 0.5 kg.
          const min = i.unit === 'UNIT' ? 1 : 0.01;
          return {
            ...i,
            quantity: roundQuantity(Math.max(min, Math.min(quantity, i.maxQuantity))),
          };
        })
        .filter((i) => i.quantity > 0),
    );
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const itemCount = useMemo(() => items.reduce((sum, i) => sum + i.quantity, 0), [items]);
  const subtotalCents = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity * i.priceCents, 0),
    [items],
  );

  const value = useMemo(
    () => ({ items, itemCount, subtotalCents, addItem, removeItem, setQuantity, clear }),
    [items, itemCount, subtotalCents, addItem, removeItem, setQuantity, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside a CartProvider');
  return ctx;
}
