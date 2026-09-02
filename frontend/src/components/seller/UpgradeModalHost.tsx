'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { onUpgradeNeeded, type UpgradeDetail } from '@/lib/upgradePrompt';

// Phase 5 — mounted once in the dashboard (shell) layout. Listens for the
// `vendylio:upgrade` event that `handleGateError` dispatches and shows a
// single "go Pro" modal instead of every gated surface rendering a raw string.

const FEATURE_LABEL: Record<string, string> = {
  promoCodes: 'Promo codes',
  advancedAnalytics: 'Storefront analytics',
  customDomain: 'Custom domain',
  teamMembers: 'Team members',
  heroImageLimit: 'Extra hero images',
  aiMonthlyQuota: 'Unlimited AI descriptions',
  whiteLabel: 'Removing the Vendylio badge',
};

function titleFor(d: UpgradeDetail): string {
  if (d.code === 'AI_QUOTA_EXCEEDED') return "You've used this month's free AI descriptions";
  if (d.code === 'PAYMENT_METHOD_REQUIRED') return 'A card on file is needed for this';
  const label = d.feature ? FEATURE_LABEL[d.feature] : undefined;
  return label ? `${label} is a Pro feature` : 'This is a Pro feature';
}

export function UpgradeModalHost() {
  const [detail, setDetail] = useState<UpgradeDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(
    () =>
      onUpgradeNeeded((d) => {
        setErr(null);
        setDetail(d);
      }),
    [],
  );

  if (!detail) return null;

  const isCard = detail.code === 'PAYMENT_METHOD_REQUIRED';

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const path = isCard ? '/api/billing/setup-intent' : '/api/billing/checkout';
      const res = await api<{ url: string }>(path, { method: 'POST' });
      window.location.href = res.url;
    } catch (e) {
      setErr(
        e instanceof ApiError && e.code === 'BILLING_NOT_CONFIGURED'
          ? "Billing isn't available yet — check back soon."
          : e instanceof ApiError
            ? e.message
            : 'Network error. Try again.',
      );
      setBusy(false);
    }
  }

  return (
    <Modal onClose={() => setDetail(null)}>
      <div className="max-w-sm p-6 text-center">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-accent">
          <Icon i="lock" size={18} />
        </span>
        <h2 className="mb-2 font-headings text-lg font-bold text-foreground">{titleFor(detail)}</h2>
        <p className="mb-5 text-sm text-muted-foreground">{detail.message}</p>
        {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
        <button
          type="button"
          onClick={go}
          disabled={busy}
          className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          {busy ? 'Opening…' : isCard ? 'Add a card' : 'Upgrade to Pro'}
        </button>
        <div className="mt-3 flex justify-center gap-4 text-xs">
          {!isCard && (
            <a href="/pricing" target="_blank" rel="noreferrer" className="font-medium text-accent">
              Compare plans
            </a>
          )}
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="font-medium text-muted-foreground"
          >
            Not now
          </button>
        </div>
      </div>
    </Modal>
  );
}
