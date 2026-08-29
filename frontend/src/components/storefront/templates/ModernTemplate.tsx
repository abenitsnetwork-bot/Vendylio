'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PublicStore } from '@/lib/server/storefront';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { formatUsdPerUnit, formatQuantityWithUnit } from '@/lib/productUnits';
import { toAddableProduct } from '@/lib/productVariants';
import { groupProductsByCategory, sectionTitle } from '@/lib/storefrontGrouping';
import { useCart } from '@/contexts/CartContext';
import { StoreReviews } from '@/components/storefront/StoreReviews';
import { StorefrontCategoryNav } from '@/components/storefront/StorefrontCategoryNav';
import { StorefrontTopBar } from '@/components/storefront/StorefrontTopBar';
import { StorefrontHeader } from '@/components/storefront/StorefrontHeader';

export function ModernTemplate({
  store,
  onOpenCart,
}: {
  store: PublicStore;
  onOpenCart: () => void;
}) {
  const { addItem } = useCart();
  const [query, setQuery] = useState('');
  const location = [store.city, store.state].filter(Boolean).join(', ');
  const sections = groupProductsByCategory(store.products, store.categories, query);

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

      <header className="border-b border-border bg-card px-4 py-6 lg:px-14">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          {store.logoUrl ? (
            <img
              src={store.logoUrl}
              alt=""
              className="h-16 w-16 flex-shrink-0 rounded-lg object-cover"
            />
          ) : (
            <ImagePlaceholder icon="store" className="h-16 w-16 flex-shrink-0 rounded-lg" />
          )}
          <div>
            <h1 className="font-headings text-2xl font-bold text-foreground">{store.name}</h1>
            {location && <p className="text-sm text-muted-foreground">{location}</p>}
          </div>
        </div>
        {store.description && (
          <p className="mx-auto mt-4 max-w-5xl text-sm text-muted-foreground">
            {store.description}
          </p>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 lg:px-14">
        {store.products.length === 0 ? (
          <div className="py-20 text-center">
            <ImagePlaceholder icon="package" className="mx-auto mb-4 h-16 w-16 rounded-full" />
            <p className="text-sm text-muted-foreground">
              This store hasn&apos;t added any products yet — check back soon.
            </p>
          </div>
        ) : sections.length === 0 ? (
          <p className="py-20 text-center text-sm text-muted-foreground">
            No products match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <>
            <StorefrontCategoryNav sections={sections} />
            {sections.map((section) => (
              <section key={section.anchor} id={section.anchor} className="mb-12 scroll-mt-20">
                <h2 className="mb-5 font-headings text-xl font-bold text-foreground">
                  {sectionTitle(section)}
                </h2>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {section.products.map((product) => {
                    const hasVariants = product.variants.length > 0;
                    const addable = toAddableProduct(product, product.variants[0]?.id ?? null);
                    const soldOut = !hasVariants && addable.quantity <= 0;
                    return (
                      <div
                        key={product.id}
                        className="overflow-hidden rounded-xl border border-border bg-card"
                      >
                        <Link
                          href={`/s/${store.slug}/products/${product.id}`}
                          className="relative block"
                        >
                          {product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt={product.name}
                              className="h-48 w-full object-cover"
                            />
                          ) : (
                            <ImagePlaceholder icon="package" className="h-48 w-full" />
                          )}
                          {soldOut && (
                            <span className="absolute right-3 top-3 rounded bg-foreground px-2 py-1 text-xs font-semibold text-background">
                              Sold out
                            </span>
                          )}
                        </Link>
                        <div className="p-5">
                          <Link href={`/s/${store.slug}/products/${product.id}`}>
                            <p className="mb-1 font-headings text-base font-semibold text-foreground hover:text-primary">
                              {product.name}
                            </p>
                          </Link>
                          {product.description && (
                            <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
                              {product.description}
                            </p>
                          )}
                          <div className="mb-3 flex items-center justify-between">
                            <p className="font-headings text-lg font-bold text-foreground">
                              {formatUsdPerUnit(addable.priceCents, product.unit)}
                            </p>
                            {!soldOut && !hasVariants && addable.quantity <= 5 && (
                              <span className="text-xs text-muted-foreground">
                                Only {formatQuantityWithUnit(addable.quantity, product.unit)} left
                              </span>
                            )}
                          </div>
                          {hasVariants ? (
                            <Link
                              href={`/s/${store.slug}/products/${product.id}`}
                              className="block w-full rounded-lg border border-border py-2.5 text-center text-sm font-semibold text-foreground hover:bg-secondary"
                            >
                              View Options
                            </Link>
                          ) : (
                            <button
                              type="button"
                              disabled={soldOut}
                              onClick={() => addItem(addable)}
                              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {soldOut ? 'Sold out' : 'Add to Cart'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
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
