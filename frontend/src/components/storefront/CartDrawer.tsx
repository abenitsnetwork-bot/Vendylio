'use client';

import Link from 'next/link';
import { Drawer } from '@/components/ui/Drawer';
import { Icon } from '@/components/ui/Icon';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { formatUsdPerUnit } from '@/lib/productUnits';
import { useCart } from '@/contexts/CartContext';

export function CartDrawer({ storeSlug, onClose }: { storeSlug: string; onClose: () => void }) {
  const { items, subtotalCents, removeItem, setQuantity } = useCart();

  return (
    <Drawer onClose={onClose}>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="font-headings text-lg font-bold text-foreground">
          Your Cart {items.length > 0 && `(${items.length})`}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close cart"
          className="text-muted-foreground"
        >
          <Icon i="x" size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Icon i="shopping-bag" size={32} className="mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Your cart is empty.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <div key={`${item.productId}:${item.variantId ?? ''}`} className="flex gap-3">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="h-16 w-16 flex-shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <ImagePlaceholder icon="package" className="h-16 w-16 flex-shrink-0 rounded-lg" />
                )}
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{item.name}</p>
                    <button
                      type="button"
                      onClick={() => removeItem(item.productId, item.variantId)}
                      aria-label={`Remove ${item.name}`}
                      className="text-muted-foreground"
                    >
                      <Icon i="x" size={14} />
                    </button>
                  </div>
                  {item.variantLabel && (
                    <p className="text-xs text-muted-foreground">{item.variantLabel}</p>
                  )}
                  <p className="mb-2 text-sm text-muted-foreground">
                    {formatUsdPerUnit(item.priceCents, item.unit)}
                  </p>
                  {item.unit === 'UNIT' ? (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setQuantity(item.productId, item.quantity - 1, item.variantId)
                        }
                        className="flex h-7 w-7 items-center justify-center rounded border border-border text-foreground"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="w-4 text-center text-sm text-foreground">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setQuantity(item.productId, item.quantity + 1, item.variantId)
                        }
                        disabled={item.quantity >= item.maxQuantity}
                        className="flex h-7 w-7 items-center justify-center rounded border border-border text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0.01"
                        max={item.maxQuantity}
                        step="0.01"
                        value={item.quantity}
                        onChange={(e) =>
                          setQuantity(item.productId, Number(e.target.value), item.variantId)
                        }
                        aria-label={`Quantity in ${item.unit.toLowerCase()}`}
                        className="w-20 rounded border border-border px-2 py-1 text-sm text-foreground"
                      />
                      <span className="text-xs text-muted-foreground">
                        {item.unit.toLowerCase()} (max {item.maxQuantity.toFixed(2)})
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border p-4">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Subtotal</span>
          <span className="font-headings text-lg font-bold text-foreground">
            {formatUsdPerUnit(subtotalCents, 'UNIT')}
          </span>
        </div>
        {items.length === 0 ? (
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground opacity-50"
          >
            Checkout
          </button>
        ) : (
          <Link
            href={`/s/${storeSlug}/checkout`}
            className="block w-full rounded-lg bg-primary px-6 py-3 text-center text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Checkout
          </Link>
        )}
      </div>
    </Drawer>
  );
}
