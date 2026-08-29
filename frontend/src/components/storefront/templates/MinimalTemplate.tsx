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

export function MinimalTemplate({
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

      <header className="mx-auto max-w-2xl px-4 py-16 text-center lg:px-0">
        {store.logoUrl ? (
          <img
            src={store.logoUrl}
            alt=""
            className="mx-auto mb-6 h-20 w-20 rounded-full object-cover"
          />
        ) : (
          <ImagePlaceholder icon="store" className="mx-auto mb-6 h-20 w-20 rounded-full" />
        )}
        <h1 className="font-headings text-3xl font-bold text-foreground">{store.name}</h1>
        {location && <p className="mt-1 text-sm text-muted-foreground">{location}</p>}
        {store.description && (
          <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">{store.description}</p>
        )}
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-16 lg:px-0">
        {store.products.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            This store hasn&apos;t added any products yet — check back soon.
          </p>
        ) : sections.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No products match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <>
            <StorefrontCategoryNav sections={sections} />
            {sections.map((section) => (
              <section key={section.anchor} id={section.anchor} className="mb-10 scroll-mt-20">
                <h2 className="mb-2 font-headings text-lg font-bold text-foreground">
                  {sectionTitle(section)}
                </h2>
                <div className="divide-y divide-border border-t border-border">
                  {section.products.map((product) => {
                    const hasVariants = product.variants.length > 0;
                    const addable = toAddableProduct(product, product.variants[0]?.id ?? null);
                    const soldOut = !hasVariants && addable.quantity <= 0;
                    return (
                      <div key={product.id} className="flex items-center gap-4 py-3.5">
                        <Link
                          href={`/s/${store.slug}/products/${product.id}`}
                          className="flex-shrink-0"
                        >
                          {product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt={product.name}
                              className="h-14 w-14 rounded-lg object-cover"
                            />
                          ) : (
                            <ImagePlaceholder icon="package" className="h-14 w-14 rounded-lg" />
                          )}
                        </Link>
                        <div className="min-w-0 flex-1">
                          <Link href={`/s/${store.slug}/products/${product.id}`}>
                            <p className="truncate font-headings text-sm font-semibold text-foreground hover:text-primary">
                              {product.name}
                            </p>
                          </Link>
                          {product.description && (
                            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                              {product.description}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-3 text-right">
                          <p className="font-headings text-sm font-bold text-foreground">
                            {formatUsdPerUnit(addable.priceCents, product.unit)}
                          </p>
                          {hasVariants ? (
                            <Link
                              href={`/s/${store.slug}/products/${product.id}`}
                              className="inline-block rounded-lg border border-border px-4 py-1.5 text-xs font-semibold text-foreground"
                            >
                              Options
                            </Link>
                          ) : (
                            <button
                              type="button"
                              disabled={soldOut}
                              onClick={() => addItem(addable)}
                              className="rounded-lg border border-border px-4 py-1.5 text-xs font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {soldOut ? 'Sold out' : 'Add'}
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
