// Guest checkout — Phase 2. Server Component reads the store (same pattern
// as the storefront page); the actual form + cart summary is a Client
// Component since it reads the localStorage-backed cart.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicStore } from '@/lib/server/storefront';
import { CheckoutForm } from '@/components/storefront/CheckoutForm';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ slug: string }>;
}

export default async function CheckoutPage({ params }: Params) {
  const { slug } = await params;
  const store = await getPublicStore(slug);
  if (!store) notFound();

  // Phase 8 — a direct link to /checkout bypasses the disabled cart button,
  // so re-check the pause switch here (the API enforces it too — this is the
  // friendly version instead of a 409 on submit).
  if (!store.acceptingOrders) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center font-body">
        <h1 className="mb-2 font-headings text-xl font-bold text-foreground">
          {store.name} isn’t accepting orders right now
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {store.pauseMessage?.trim() || 'Please check back soon.'}
        </p>
        <Link
          href={`/s/${slug}`}
          className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Back to store
        </Link>
      </div>
    );
  }

  return (
    <CheckoutForm
      storeSlug={store.slug}
      storeName={store.name}
      cashAppCashtag={store.cashAppCashtag}
      zelleContact={store.zelleContact}
      deliveryFeeCents={store.deliveryFeeCents}
      deliveryProvider={store.deliveryProvider}
      pickupAddress={store.pickupAddress}
    />
  );
}
