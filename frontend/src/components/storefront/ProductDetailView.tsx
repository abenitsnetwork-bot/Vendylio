'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicProduct, PublicStoreHeader } from '@/lib/server/storefront';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { formatUsdPerUnit, formatQuantityWithUnit } from '@/lib/productUnits';
import { toAddableProduct } from '@/lib/productVariants';
import { useCart } from '@/contexts/CartContext';
import { StorefrontTopBar } from '@/components/storefront/StorefrontTopBar';
import { StorefrontHeader } from '@/components/storefront/StorefrontHeader';
import { Breadcrumbs } from '@/components/storefront/Breadcrumbs';
import { VariantSwatches } from '@/components/storefront/VariantSwatches';
import { QuantityStepper } from '@/components/storefront/QuantityStepper';
import { CartDrawer } from '@/components/storefront/CartDrawer';

export function ProductDetailView({
  store,
  product,
}: {
  store: PublicStoreHeader;
  product: PublicProduct;
}) {
  const { addItem } = useCart();
  const router = useRouter();
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    product.variants[0]?.id ?? null,
  );
  const [qty, setQty] = useState(1);

  const hasVariants = product.variants.length > 0;
  const addable = toAddableProduct(product, selectedVariantId);
  const soldOut = addable.quantity <= 0;
  const effectiveQty = Math.min(qty, Math.max(addable.quantity, 1));

  function handleAddToCart() {
    addItem(addable, effectiveQty);
  }

  function handleBuyNow() {
    addItem(addable, effectiveQty);
    router.push(`/s/${store.slug}/checkout`);
  }

  return (
    <div className="min-h-screen bg-background font-body">
      <StorefrontTopBar phone={store.phone} />
      <StorefrontHeader
        storeSlug={store.slug}
        storeName={store.name}
        logoUrl={store.logoUrl}
        onOpenCart={() => setCartOpen(true)}
      />
      <Breadcrumbs
        items={[
          { label: store.name, href: `/s/${store.slug}` },
          ...(product.category
            ? [{ label: product.category.name, href: `/s/${store.slug}#${product.category.slug}` }]
            : []),
          { label: product.name },
        ]}
      />

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-8 lg:grid-cols-2 lg:px-14 lg:py-10">
        <div className="overflow-hidden rounded-2xl bg-secondary">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="aspect-square w-full object-cover"
            />
          ) : (
            <ImagePlaceholder icon="package" className="aspect-square w-full" />
          )}
        </div>

        <div>
          <h1
            className="mb-2 font-headings font-bold text-foreground"
            style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.5px' }}
          >
            {product.name}
          </h1>
          {product.description && (
            <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          )}

          <p className="mb-6 font-headings text-2xl font-bold text-foreground">
            {formatUsdPerUnit(addable.priceCents, product.unit)}
          </p>

          {hasVariants && (
            <div className="mb-6">
              <p className="mb-2 text-sm font-semibold text-foreground">Choose an option</p>
              <VariantSwatches
                variants={product.variants}
                selectedId={selectedVariantId}
                onSelect={(id) => {
                  setSelectedVariantId(id);
                  setQty(1);
                }}
              />
            </div>
          )}

          <div className="mb-2 flex items-center gap-4">
            <QuantityStepper
              quantity={effectiveQty}
              unit={product.unit}
              max={Math.max(addable.quantity, 1)}
              onChange={setQty}
            />
            {soldOut ? (
              <span className="text-sm font-semibold text-red-600">Sold out</span>
            ) : (
              addable.quantity <= 5 && (
                <span className="text-sm text-accent">
                  Only {formatQuantityWithUnit(addable.quantity, product.unit)} left!
                </span>
              )
            )}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={soldOut}
              onClick={handleBuyNow}
              className="flex-1 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Buy Now
            </button>
            <button
              type="button"
              disabled={soldOut}
              onClick={handleAddToCart}
              className="flex-1 rounded-full border border-border bg-card px-6 py-3.5 text-sm font-semibold text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {soldOut ? 'Sold out' : 'Add to Cart'}
            </button>
          </div>
        </div>
      </main>

      {cartOpen && <CartDrawer storeSlug={store.slug} onClose={() => setCartOpen(false)} />}
    </div>
  );
}
