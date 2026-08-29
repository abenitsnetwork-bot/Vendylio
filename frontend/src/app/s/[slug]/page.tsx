// Public storefront — what a seller's customers actually see when they open
// the link from "Share Your Store". Not part of the Banani selection (no
// screen for it was fetched); designed to match the same tokens/primitives.
//
// Server Component with a direct data read (not routed through /api/*) so
// the page is real SSR HTML — this is a link shared in Instagram bios and
// WhatsApp statuses, where link-preview crawlers and first paint matter.
// Interactivity (template rendering, cart) lives in the client-side
// StorefrontShell this page hands the data to.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { viewerOwnsSlug } from '@/lib/server/storePreview';
import { getPublicStore, type PublicStore } from '@/lib/server/storefront';
import { StorefrontShell } from '@/components/storefront/StorefrontShell';
import { JsonLd } from '@/components/JsonLd';
import { storeMetadata, storeJsonLd } from '@/lib/seo';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ slug: string }>;
}

// A draft store 404s for the public, but its own owner can preview it: if the
// signed-in seller owns a store with this exact slug, fetch it including the
// unpublished state so they can walk the "Review your store" step for real.
async function resolveStoreForViewer(slug: string): Promise<PublicStore | null> {
  const live = await getPublicStore(slug);
  if (live) return live;
  if (!(await viewerOwnsSlug(slug))) return null;
  return getPublicStore(slug, { includeUnpublished: true });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const store = await resolveStoreForViewer(slug);
  if (!store) return { title: 'Store not found', robots: { index: false, follow: false } };
  // A preview (draft) storefront must never be indexed.
  if (!store.published) {
    return { title: `Preview — ${store.name}`, robots: { index: false, follow: false } };
  }
  return storeMetadata(store);
}

export default async function StorefrontPage({ params }: Params) {
  const { slug } = await params;
  const store = await resolveStoreForViewer(slug);
  if (!store) notFound();

  return (
    <>
      {store.published && <JsonLd data={storeJsonLd(store)} />}
      <StorefrontShell store={store} />
    </>
  );
}
