import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { isStoreTemplate, type StoreTemplate } from '@/lib/storeTemplates';
import { getStoreOpenState } from '@/lib/server/store/availability';
import { parseHeroImages, type StoreHero } from '@/lib/storeHero';

export interface PublicProductVariant {
  id: string;
  name: string;
  value: string;
  priceDeltaCents: number;
  quantity: number;
}

export interface PublicCategory {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  /** Phase 9b — optional emoji shown before the name in nav + headings. */
  icon: string | null;
}

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  quantity: number;
  category: { id: string; name: string; slug: string } | null;
  unit: string;
  imageUrl: string | null;
  variants: PublicProductVariant[];
}

export interface PublicReview {
  id: string;
  rating: number;
  text: string | null;
  customerName: string | null;
  createdAt: Date;
}

export interface PublicStore {
  slug: string;
  name: string;
  description: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  phone: string | null;
  // Manual payment methods offered at checkout — see CheckoutForm's
  // payment-method selector, which only offers Cash App/Zelle when the
  // corresponding field is set.
  cashAppCashtag: string | null;
  zelleContact: string | null;
  // Checkout's Pickup/Delivery choice reads these — deliveryFeeCents is the
  // flat fee charged when the buyer picks Delivery (unless deliveryProvider
  // is uber_direct, in which case checkout fetches a live quote instead);
  // pickupAddress (if set) is shown when they pick Pickup.
  deliveryFeeCents: number;
  deliveryProvider: string;
  pickupAddress: string | null;
  template: StoreTemplate;
  /** Phase 9b — thin promo strip at the top of the storefront; null = none. */
  announcement: string | null;
  // Phase 9 — storefront hero carousel. `images` empty = no hero (storefront
  // renders exactly as before). `headline`/`subhead` are one global promo
  // message overlaid on every slide.
  hero: StoreHero;
  // Phase 8 — store operations. `acceptingOrders` is the hard switch (false =
  // checkout is blocked server-side too). `openState` is informational: it
  // drives a "currently closed" banner but does NOT block checkout.
  acceptingOrders: boolean;
  pauseMessage: string | null;
  openState: { hoursConfigured: boolean; openNow: boolean; nextOpenLabel: string | null };
  // Seller-defined, ordered. Products are grouped under these on the
  // storefront; a product whose `category` is null falls under an implicit
  // "Uncategorized" section rendered last.
  categories: PublicCategory[];
  products: PublicProduct[];
  reviews: PublicReview[];
  averageRating: number | null;
  reviewCount: number;
}

/** Subset of PublicStore needed to render the header/top bar on a page that
 * isn't the main storefront listing (e.g. a product detail page). */
export interface PublicStoreHeader {
  slug: string;
  name: string;
  logoUrl: string | null;
  phone: string | null;
  template: StoreTemplate;
}

/**
 * Public storefront read — no auth, no seller-only fields (organizationId,
 * id, timestamps). Only ACTIVE products are shown; ARCHIVED ones stay hidden
 * from customers but remain in the seller's own product history. Unpublished
 * stores 404 here just like a nonexistent slug would.
 */
export async function getPublicStore(slug: string): Promise<PublicStore | null> {
  const store = await prisma.store.findFirst({
    where: { slug, published: true },
    select: {
      slug: true,
      name: true,
      description: true,
      city: true,
      state: true,
      logoUrl: true,
      phone: true,
      cashAppCashtag: true,
      zelleContact: true,
      deliveryFeeCents: true,
      deliveryProvider: true,
      pickupAddress: true,
      template: true,
      announcement: true,
      heroImages: true,
      heroHeadline: true,
      heroSubhead: true,
      timezone: true,
      ordersPaused: true,
      pauseMessage: true,
      hours: true,
      categories: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, slug: true, sortOrder: true, icon: true },
      },
      products: {
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          priceCents: true,
          quantity: true,
          category: { select: { id: true, name: true, slug: true } },
          unit: true,
          imageUrl: true,
          variants: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true, value: true, priceDeltaCents: true, quantity: true },
          },
        },
      },
      // Phase 8 — visible reviews only; hidden ones are the seller's
      // moderation call and never reach the public read. Unpaginated like
      // `products` above — average/count are derived from this same array
      // in JS rather than a second aggregate query, since a Store-scoped
      // `id` would otherwise have to be selected just to run it (this read
      // deliberately never selects Store.id — see the test asserting that).
      reviews: {
        where: { visible: true },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          rating: true,
          text: true,
          createdAt: true,
          order: { select: { customerName: true } },
        },
      },
    },
  });
  if (!store) return null;

  const reviews: PublicReview[] = store.reviews.map((r) => ({
    id: r.id,
    rating: r.rating,
    text: r.text,
    customerName: r.order.customerName,
    createdAt: r.createdAt,
  }));
  const reviewCount = reviews.length;
  const averageRating = reviewCount
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
    : null;

  const {
    timezone,
    ordersPaused,
    pauseMessage,
    hours,
    heroImages,
    heroHeadline,
    heroSubhead,
    ...publicFields
  } = store;
  return {
    ...publicFields,
    template: isStoreTemplate(store.template) ? store.template : 'MODERN',
    hero: {
      images: parseHeroImages(heroImages),
      headline: heroHeadline,
      subhead: heroSubhead,
    },
    acceptingOrders: !ordersPaused,
    pauseMessage,
    openState: getStoreOpenState({ timezone, hours }),
    reviews,
    averageRating,
    reviewCount,
  };
}

export interface PublicProductDetail {
  store: PublicStoreHeader;
  product: PublicProduct;
}

/**
 * Public product-detail read — no auth. Scoped to a published store's own
 * ACTIVE products only, same visibility rules as getPublicStore (a product
 * belonging to someone else's store, or an unpublished/archived one, reads
 * as null → the route 404s, never leaks existence).
 */
export async function getPublicProduct(
  slug: string,
  productId: string,
): Promise<PublicProductDetail | null> {
  const store = await prisma.store.findFirst({
    where: { slug, published: true },
    select: {
      slug: true,
      name: true,
      logoUrl: true,
      phone: true,
      template: true,
      products: {
        where: { id: productId, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          description: true,
          priceCents: true,
          quantity: true,
          category: { select: { id: true, name: true, slug: true } },
          unit: true,
          imageUrl: true,
          variants: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, name: true, value: true, priceDeltaCents: true, quantity: true },
          },
        },
      },
    },
  });
  const product = store?.products[0];
  if (!store || !product) return null;

  return {
    store: {
      slug: store.slug,
      name: store.name,
      logoUrl: store.logoUrl,
      phone: store.phone,
      template: isStoreTemplate(store.template) ? store.template : 'MODERN',
    },
    product,
  };
}
