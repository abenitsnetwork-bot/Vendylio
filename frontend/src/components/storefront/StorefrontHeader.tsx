'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { useCart } from '@/contexts/CartContext';

/** Shared header used by all three storefront templates and the product
 * detail page — logo/name link home, an optional live search box (product
 * listing pages pass one; the detail page doesn't need it), and a cart
 * button that always reflects the real cart count via useCart(). */
export function StorefrontHeader({
  storeSlug,
  storeName,
  logoUrl,
  onOpenCart,
  searchQuery,
  onSearchChange,
}: {
  storeSlug: string;
  storeName: string;
  logoUrl: string | null;
  onOpenCart: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}) {
  const { itemCount } = useCart();

  return (
    <header className="border-b border-border bg-card px-4 py-4 lg:px-14">
      <div className="mx-auto flex max-w-6xl items-center gap-4">
        <Link href={`/s/${storeSlug}`} className="flex flex-shrink-0 items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <ImagePlaceholder icon="store" className="h-10 w-10 rounded-lg" />
          )}
          <span className="hidden font-headings text-lg font-bold text-foreground sm:inline">
            {storeName}
          </span>
        </Link>

        {onSearchChange && (
          <div className="relative ml-auto hidden max-w-xs flex-1 sm:block">
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
        )}

        <button
          type="button"
          onClick={onOpenCart}
          aria-label="Open cart"
          className={`relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-border text-foreground ${
            onSearchChange ? '' : 'ml-auto'
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
    </header>
  );
}
