// Stripe redirects here when the buyer cancels/abandons the hosted
// Checkout page. The Order row stays PENDING (untouched) — the cron at
// lib/server/orders/expire.ts will mark it EXPIRED after 24h if the buyer
// never returns to retry, so nothing needs to happen here beyond guiding
// them back to the cart.
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ slug: string; orderId: string }>;
}

export default async function OrderFailedPage({ params }: Params) {
  const { slug } = await params;

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
        href={`/s/${slug}/checkout`}
        className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Try Again
      </Link>
    </div>
  );
}
