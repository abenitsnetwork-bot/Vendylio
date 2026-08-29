'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PublicStore } from '@/lib/server/storefront';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { formatUsdPerUnit } from '@/lib/productUnits';
import { toAddableProduct } from '@/lib/productVariants';
import { useCart } from '@/contexts/CartContext';
import { StoreReviews } from '@/components/storefront/StoreReviews';
import { StorefrontTopBar } from '@/components/storefront/StorefrontTopBar';
import { StorefrontHeader } from '@/components/storefront/StorefrontHeader';

export function BoldTemplate({
  store,
  onOpenCart,
}: {
  store: PublicStore;
  onOpenCart: () => void;
}) {
  const { addItem } = useCart();
  const [query, setQuery] = useState('');
  const location = [store.city, store.state].filter(Boolean).join(', ');
  const products = store.products.filter((p) =>
    p.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div>
      <StorefrontTopBar phone={store.phone} />
      <StorefrontHeader
        storeSlug={store.slug}
        storeName={store.name}
        logoUrl={store.logoUrl}
        onOpenCart={onOpenCart}
        searchQuery={query}
        onSearchChange={setQuery}
      />

      <header className="bg-primary px-4 py-16 text-primary-foreground lg:px-14">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4">
          {store.logoUrl ? (
            <img
              src={store.logoUrl}
              alt=""
              className="h-20 w-20 rounded-xl border-2 border-primary-foreground object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-primary-foreground bg-primary-foreground/10">
              <span className="font-headings text-3xl font-bold">{store.name.charAt(0)}</span>
            </div>
          )}
          <h1
            className="font-headings font-bold"
            style={{ fontSize: 'clamp(32px, 6vw, 56px)', letterSpacing: '-1.5px' }}
          >
            {store.name}
          </h1>
          {location && <p className="text-sm opacity-80">{location}</p>}
          {store.description && (
            <p className="max-w-xl text-base opacity-90">{store.description}</p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-14 lg:px-14">
        {store.products.length === 0 ? (
          <div className="py-20 text-center">
            <ImagePlaceholder icon="package" className="mx-auto mb-4 h-16 w-16 rounded-full" />
            <p className="text-sm text-muted-foreground">
              This store hasn&apos;t added any products yet — check back soon.
            </p>
          </div>
        ) : products.length === 0 ? (
          <p className="py-20 text-center text-sm text-muted-foreground">
            No products match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2">
            {products.map((product) => {
              const hasVariants = product.variants.length > 0;
              const addable = toAddableProduct(product, product.variants[0]?.id ?? null);
              const soldOut = !hasVariants && addable.quantity <= 0;
              return (
                <div key={product.id} className="flex flex-col">
                  <Link
                    href={`/s/${store.slug}/products/${product.id}`}
                    className="relative mb-4 block overflow-hidden rounded-2xl"
                  >
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="h-72 w-full object-cover"
                      />
                    ) : (
                      <ImagePlaceholder icon="package" className="h-72 w-full" />
                    )}
                    {soldOut && (
                      <span className="absolute right-4 top-4 rounded bg-foreground px-3 py-1.5 text-xs font-semibold text-background">
                        Sold out
                      </span>
                    )}
                  </Link>
                  {product.category && (
                    <span className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
                      {product.category.name}
                    </span>
                  )}
                  <Link href={`/s/${store.slug}/products/${product.id}`}>
                    <p className="mb-2 font-headings text-2xl font-bold text-foreground hover:text-primary">
                      {product.name}
                    </p>
                  </Link>
                  {product.description && (
                    <p className="mb-4 text-base text-muted-foreground">{product.description}</p>
                  )}
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-headings text-3xl font-bold text-foreground">
                      {formatUsdPerUnit(addable.priceCents, product.unit)}
                    </p>
                    {hasVariants ? (
                      <Link
                        href={`/s/${store.slug}/products/${product.id}`}
                        className="rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground"
                      >
                        View Options
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled={soldOut}
                        onClick={() => addItem(addable)}
                        className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {soldOut ? 'Sold out' : 'Add to Cart'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <StoreReviews
          reviews={store.reviews}
          averageRating={store.averageRating}
          reviewCount={store.reviewCount}
        />
      </main>
    </div>
  );
}
