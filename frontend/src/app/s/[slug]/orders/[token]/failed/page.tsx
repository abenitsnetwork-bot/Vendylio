// Stripe redirects here when the buyer cancels/abandons the hosted Checkout
// page — a reliable "gave up" signal, so this cancels the Order immediately
// (cancelAbandonedOrder) instead of leaving it PENDING for the
// order-expiration cron to clean up ORDER_EXPIRATION_MINUTES later. Guest
// checkout means the high-entropy `token` in the URL is the only credential
// here, same trust model as the success/tracking page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { prisma } from '@/lib/server/prisma';
import { cancelAbandonedOrder } from '@/lib/server/orders/cancelAbandoned';
import { getPublicStore, getViaDomain } from '@/lib/server/storefront';

export const runtime = 'nodejs';

// Private order page — never indexed (§87/§125).
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

interface Params {
  params: Promise<{ slug: string; token: string }>;
}

export default async function OrderFailedPage({ params }: Params) {
  const { slug, token } = await params;
  const store = await getPublicStore(slug, { viaDomain: await getViaDomain() });
  const linkBase = store?.linkBase ?? `/s/${slug}`;

  // Best-effort — a DB hiccup here must never break rendering the page the
  // buyer is actively looking at. Worst case the cron catches it later.
  try {
    const order = await prisma.order.findUnique({
      where: { trackingToken: token },
      select: { id: true },
    });
    if (order) await cancelAbandonedOrder(prisma, order.id);
  } catch {
    // swallow — see comment above
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center font-body">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        <Icon i="x" size={24} className="text-foreground" />
      </div>
      <h1
        className="mb-2 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(22px, 4vw, 28px)' }}
      >
        Payment not completed
      </h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Your card was not charged. You can try again from your cart.
      </p>
      <Link
        href={`${linkBase}/checkout`}
        className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Try Again
      </Link>
    </div>
  );
}
