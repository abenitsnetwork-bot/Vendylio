'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { useCart } from '@/contexts/CartContext';

/** Shared header used by all three storefront templates and the product
 * detail page. Mobile-first: on a phone the search box drops to its own
 * full-width row beneath the logo/cart row; from `sm` up it sits inline.
 * `location` shows beside the name, `description` as a thin line beneath. */
export function StorefrontHeader({
  storeSlug,
  storeName,
  logoUrl,
  location,
  description,
  onOpenCart,
  searchQuery,
  onSearchChange,
}: {
  storeSlug: string;
  storeName: string;
  logoUrl: string | null;
  location?: string | null;
  description?: string | null;
  onOpenCart: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}) {
  const { itemCount } = useCart();

  const searchBox = onSearchChange ? (
    <div className="relative w-full">
      <Icon
        i="search"
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        value={searchQuery ?? ''}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search products…"
        aria-label="Search products"
        className="w-full rounded-full border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground"
      />
    </div>
  ) : null;

  return (
    <header className="border-b border-border bg-card px-3 py-3 sm:px-5 lg:px-8 xl:px-10">
      <div className="flex items-center gap-3 sm:gap-4">
        <Link href={`/s/${storeSlug}`} className="flex min-w-0 flex-shrink-0 items-center gap-3">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={storeName}
              className="h-12 w-12 rounded-xl object-cover sm:h-14 sm:w-14"
              width={56}
              height={56}
            />
          ) : (
            <ImagePlaceholder icon="store" className="h-12 w-12 rounded-xl sm:h-14 sm:w-14" />
          )}
          <span className="min-w-0">
            <span className="block truncate font-headings text-base font-bold text-foreground sm:text-lg">
              {storeName}
            </span>
            {location && (
              <span className="block truncate text-xs text-muted-foreground">{location}</span>
            )}
          </span>
        </Link>

        {searchBox && <div className="ml-auto hidden max-w-xs flex-1 sm:block">{searchBox}</div>}

        <button
          type="button"
          onClick={onOpenCart}
          aria-label="Open cart"
          className={`relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-border text-foreground ${
            searchBox ? '' : 'ml-auto'
          }`}
        >
          <Icon i="shopping-bag" size={18} />
          {itemCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
              {itemCount}
            </span>
          )}
        </button>
      </div>

      {/* Mobile-only search row */}
      {searchBox && <div className="mt-2.5 sm:hidden">{searchBox}</div>}

      {description && (
        <p className="mt-2 hidden truncate text-xs text-muted-foreground sm:block">{description}</p>
      )}
    </header>
  );
}
