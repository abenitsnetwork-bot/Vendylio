'use client';

// Shown once, right after a successful Pro upgrade — Stripe Checkout returns
// the merchant to `/dashboard/billing?upgraded=1`. Fires a confetti burst and
// a welcome card, then strips the query param so a refresh doesn't replay it.

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { celebrate } from '@/lib/confetti';

const PERKS = [
  '1.5% fee on card, Cash App & Zelle — down from 5%',
  'Unlimited AI product descriptions',
  'Promo codes, advanced analytics & your own custom domain',
  'Team members, bank (ACH) payouts & higher withdrawal limits',
  'Three storefront hero images — and the Vendylio badge is gone',
];

export function ProWelcomeModal() {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (params.get('upgraded') !== '1') return;
    setOpen(true);
    void celebrate();
    // Drop the param so a reload doesn't retrigger the celebration.
    router.replace('/dashboard/billing', { scroll: false });
  }, [params, router]);

  if (!open) return null;

  return (
    <Modal onClose={() => setOpen(false)}>
      <div className="text-center">
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-white"
          style={{ background: 'linear-gradient(135deg, #dd5b2e, #e11d74)' }}
        >
          <Icon i="rocket" size={26} className="text-white" />
        </div>
        <h2 className="font-headings text-2xl font-bold text-foreground">Welcome to Pro 🎉</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your upgrade is live. Here&apos;s what just unlocked:
        </p>
      </div>

      <ul className="mt-5 space-y-2.5">
        {PERKS.map((perk) => (
          <li key={perk} className="flex gap-2.5 text-sm text-foreground">
            <Icon i="check-circle" size={18} className="mt-0.5 shrink-0 text-accent" />
            <span>{perk}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-6 w-full rounded-full border border-border bg-secondary px-5 py-3 text-sm font-semibold text-foreground hover:opacity-90"
      >
        Let&apos;s go
      </button>
    </Modal>
  );
}
