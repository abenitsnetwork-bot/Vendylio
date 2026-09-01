'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PublicStore } from '@/lib/server/storefront';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { StorefrontImage } from '@/components/storefront/StorefrontImage';
import { Icon } from '@/components/ui/Icon';
import { formatQuantityWithUnit } from '@/lib/productUnits';
import { PriceTag } from '@/components/storefront/PriceTag';
import { toAddableProduct } from '@/lib/productVariants';
import { groupProductsByCategory, sectionTitle, sectionIcon } from '@/lib/storefrontGrouping';
import { useCart } from '@/contexts/CartContext';
import { StoreReviews } from '@/components/storefront/StoreReviews';
import { StorefrontCategoryNav } from '@/components/storefront/StorefrontCategoryNav';
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
      <StorefrontHeader
        linkBase={store.linkBase}
        storeName={store.name}
        logoUrl={store.logoUrl}
        location={location}
        description={store.description}
        onOpenCart={onOpenCart}
        searchQuery={query}
        onSearchChange={setQuery}
      />

      <StorefrontHero hero={store.hero} storeName={store.name} />

      <main className="w-full px-3 py-6 sm:px-5 sm:py-8 lg:px-8 xl:px-10">
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
                <h2 className="mb-5 flex items-center gap-2 font-headings text-xl font-bold text-foreground">
                  {sectionIcon(section) && <span aria-hidden="true">{sectionIcon(section)}</span>}
                  {sectionTitle(section)}
                </h2>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
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
                          href={`${store.linkBase}/products/${product.id}`}
                          className="relative block"
                        >
                          {product.imageUrl ? (
                            <StorefrontImage
                              src={product.imageUrl}
                              alt={product.name}
                              displayWidth={400}
                              sizes="(min-width: 768px) 33vw, 50vw"
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
                        <div className="flex flex-1 flex-col p-2.5">
                          <Link href={`${store.linkBase}/products/${product.id}`}>
                            <p className="line-clamp-2 font-headings text-xs font-semibold leading-snug text-foreground hover:text-primary sm:text-sm">
                              {product.name}
                            </p>
                          </Link>
                          {!soldOut && !hasVariants && addable.quantity <= 5 && (
                            <p className="mt-0.5 text-[10px] font-medium text-amber-600">
                              Only {formatQuantityWithUnit(addable.quantity, product.unit)} left
                            </p>
                          )}
                          <div className="mt-auto flex items-center justify-between gap-1.5 pt-2">
                            <PriceTag
                              cents={addable.priceCents}
                              unit={product.unit}
                              className="font-headings text-sm font-bold text-foreground sm:text-base"
                            />
                            {hasVariants ? (
                              <Link
                                href={`${store.linkBase}/products/${product.id}`}
                                className="flex-shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-secondary"
                              >
                                Options
                              </Link>
                            ) : (
                              <button
                                type="button"
                                disabled={soldOut}
                                onClick={() => addItem(addable)}
                                aria-label={soldOut ? 'Sold out' : `Add ${product.name} to cart`}
                                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Icon i="plus" size={16} />
                              </button>
                            )}
                          </div>
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
