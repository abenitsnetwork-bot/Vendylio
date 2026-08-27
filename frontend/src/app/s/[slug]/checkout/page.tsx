// Guest checkout — Phase 2. Server Component reads the store (same pattern
// as the storefront page); the actual form + cart summary is a Client
// Component since it reads the localStorage-backed cart.
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

  return (
    <CheckoutForm
      storeSlug={store.slug}
      storeName={store.name}
      cashAppCashtag={store.cashAppCashtag}
      zelleContact={store.zelleContact}
    />
  );
}
