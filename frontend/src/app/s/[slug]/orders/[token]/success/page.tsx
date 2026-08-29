// Stripe redirects here after a completed Checkout Session. This is also the
// only page a guest buyer can revisit for live order status (no account —
// the high-entropy `token` in the URL is their access credential, never the
// cuid id). OrderStatusTracker fetches GET /api/orders/track/[token]
// client-side and, once status reaches DELIVERED, offers the post-delivery
// review form. The webhook (POST /api/webhooks/stripe) remains the source of
// truth for the actual PAID transition; Stripe can redirect here before that
// webhook lands, which is why the static copy below stays deliberately
// generic and the tracker fills in the live status underneath.
import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { OrderStatusTracker } from '@/components/storefront/OrderStatusTracker';

export const runtime = 'nodejs';

// Private order page — never indexed, never cached by intermediaries (§87/§125/§134).
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

interface Params {
  params: Promise<{ slug: string; token: string }>;
}

export default async function OrderSuccessPage({ params }: Params) {
  const { slug, token } = await params;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center font-body">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary">
        <Icon i="check" size={24} className="text-primary-foreground" />
      </div>
      <h1
        className="mb-2 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(22px, 4vw, 28px)' }}
      >
        Order confirmed
      </h1>
      <p className="mb-2 text-xs text-muted-foreground">
        A receipt is on its way if you provided an email. Bookmark this page to check your order
        status later.
      </p>

      <OrderStatusTracker token={token} />

      <Link
        href={`/s/${slug}`}
        className="mt-8 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Continue Shopping
      </Link>
    </div>
  );
}
