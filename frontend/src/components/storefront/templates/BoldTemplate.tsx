'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PublicStore } from '@/lib/server/storefront';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { formatUsdPerUnit } from '@/lib/productUnits';
import { toAddableProduct } from '@/lib/productVariants';
import { groupProductsByCategory, sectionTitle } from '@/lib/storefrontGrouping';
import { useCart } from '@/contexts/CartContext';
import { StoreReviews } from '@/components/storefront/StoreReviews';
import { StorefrontCategoryNav } from '@/components/storefront/StorefrontCategoryNav';
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
        ) : sections.length === 0 ? (
          <p className="py-20 text-center text-sm text-muted-foreground">
            No products match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <>
            <StorefrontCategoryNav sections={sections} />
            {sections.map((section) => (
              <section key={section.anchor} id={section.anchor} className="mb-16 scroll-mt-20">
                <h2
                  className="mb-6 font-headings font-bold text-foreground"
                  style={{ fontSize: 'clamp(24px, 4vw, 34px)', letterSpacing: '-1px' }}
                >
                  {sectionTitle(section)}
                </h2>
                <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
                  {section.products.map((product) => {
                    const hasVariants = product.variants.length > 0;
                    const addable = toAddableProduct(product, product.variants[0]?.id ?? null);
                    const soldOut = !hasVariants && addable.quantity <= 0;
                    return (
                      <div key={product.id} className="flex flex-col">
                        <Link
                          href={`/s/${store.slug}/products/${product.id}`}
                          className="relative mb-3 block overflow-hidden rounded-xl"
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
                            <span className="absolute right-2 top-2 rounded bg-foreground px-2 py-1 text-[10px] font-semibold text-background">
                              Sold out
                            </span>
                          )}
                        </Link>
                        <Link href={`/s/${store.slug}/products/${product.id}`}>
                          <p className="mb-1 line-clamp-2 font-headings text-base font-bold text-foreground hover:text-primary">
                            {product.name}
                          </p>
                        </Link>
                        {product.description && (
                          <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">
                            {product.description}
                          </p>
                        )}
                        <div className="mt-auto flex flex-col gap-2 pt-1">
                          <p className="font-headings text-lg font-bold text-foreground">
                            {formatUsdPerUnit(addable.priceCents, product.unit)}
                          </p>
                          {hasVariants ? (
                            <Link
                              href={`/s/${store.slug}/products/${product.id}`}
                              className="w-full rounded-lg border border-border py-2 text-center text-xs font-semibold text-foreground"
                            >
                              View Options
                            </Link>
                          ) : (
                            <button
                              type="button"
                              disabled={soldOut}
                              onClick={() => addItem(addable)}
                              className="w-full rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
