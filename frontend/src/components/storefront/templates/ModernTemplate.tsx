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
import { StorefrontHero } from '@/components/storefront/StorefrontHero';

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

      <StorefrontHero hero={store.hero} storeName={store.name} />

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

      <main className="mx-auto max-w-6xl px-4 py-10 lg:px-14">
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
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {section.products.map((product) => {
                    const hasVariants = product.variants.length > 0;
                    const addable = toAddableProduct(product, product.variants[0]?.id ?? null);
                    const soldOut = !hasVariants && addable.quantity <= 0;
                    return (
                      <div
                        key={product.id}
                        className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
                      >
                        <Link
                          href={`/s/${store.slug}/products/${product.id}`}
                          className="relative block"
                        >
                          {product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt={product.name}
                              className="aspect-square w-full object-cover"
                            />
                          ) : (
                            <ImagePlaceholder icon="package" className="aspect-square w-full" />
                          )}
                          {soldOut && (
                            <span className="absolute right-2 top-2 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                              Sold out
                            </span>
                          )}
                        </Link>
                        <div className="flex flex-1 flex-col p-3">
                          <Link href={`/s/${store.slug}/products/${product.id}`}>
                            <p className="line-clamp-2 font-headings text-sm font-semibold text-foreground hover:text-primary">
                              {product.name}
                            </p>
                          </Link>
                          <div className="mb-2 mt-1 flex items-baseline justify-between gap-1">
                            <p className="font-headings text-base font-bold text-foreground">
                              {formatUsdPerUnit(addable.priceCents, product.unit)}
                            </p>
                            {!soldOut && !hasVariants && addable.quantity <= 5 && (
                              <span className="text-[10px] text-muted-foreground">
                                {formatQuantityWithUnit(addable.quantity, product.unit)} left
                              </span>
                            )}
                          </div>
                          {hasVariants ? (
                            <Link
                              href={`/s/${store.slug}/products/${product.id}`}
                              className="mt-auto block w-full rounded-lg border border-border py-2 text-center text-xs font-semibold text-foreground hover:bg-secondary"
                            >
                              View Options
                            </Link>
                          ) : (
                            <button
                              type="button"
                              disabled={soldOut}
                              onClick={() => addItem(addable)}
                              className="mt-auto w-full rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
