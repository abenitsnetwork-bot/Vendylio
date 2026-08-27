import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { isStoreTemplate, type StoreTemplate } from '@/lib/storeTemplates';

export interface PublicProductVariant {
  id: string;
  name: string;
  value: string;
  priceDeltaCents: number;
  quantity: number;
}

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  quantity: number;
  category: string;
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
  // Checkout's Pickup/Delivery choice reads these two — deliveryFeeCents is
  // the flat fee charged when the buyer picks Delivery; pickupAddress (if
  // set) is shown when they pick Pickup instead.
  deliveryFeeCents: number;
  pickupAddress: string | null;
  template: StoreTemplate;
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
      pickupAddress: true,
      template: true,
      products: {
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          priceCents: true,
          quantity: true,
          category: true,
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

  return {
    ...store,
    template: isStoreTemplate(store.template) ? store.template : 'MODERN',
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
          category: true,
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
