'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { StoreQrCode } from '@/components/seller/StoreQrCode';
import { useOnboarding } from '../layout';

interface ChecklistItem {
  label: string;
  done: boolean;
  route?: string;
  required?: boolean;
}

const PUBLISH_ERROR: Record<string, string> = {
  NOT_READY_TO_PUBLISH: 'Your store needs at least one active product before it can go live.',
  NO_STORE: 'Create your store first.',
};

export default function LaunchStepPage() {
  const { store, progress, refresh } = useOnboarding();
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!store) return null;

  const live = progress.launched;

  const items: ChecklistItem[] = [
    { label: 'Business information', done: progress.hasStore },
    { label: 'Store name & link', done: progress.hasStore },
    {
      label: 'At least one product',
      done: progress.productsReady,
      route: '/onboarding/products',
      required: true,
    },
    { label: 'Store branding', done: progress.brandCustomized, route: '/onboarding/brand' },
    { label: 'Payments', done: progress.paymentsReady, route: '/onboarding/payments' },
    { label: 'Delivery', done: progress.deliveryReady, route: '/onboarding/delivery' },
  ];
  const missingRequired = items.filter((i) => i.required && !i.done);

  const storeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/s/${store.slug}`
      : `/s/${store.slug}`;

  async function onLaunch() {
    setError(null);
    setLaunching(true);
    try {
      // The server re-validates readiness — never trust this page's checklist
      // as the gate (a second tab could have archived the last product).
      await api('/api/stores/publish', { method: 'POST' });
      refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (PUBLISH_ERROR[err.code] ?? err.message)
          : 'Could not launch your store. Try again.',
      );
    } finally {
      setLaunching(false);
    }
  }

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(storeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the link is already visible on screen.
    }
  }

  async function onShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: store?.name ?? 'My store', url: storeUrl });
        return;
      } catch {
        // user cancelled / unsupported — fall through to copy
      }
    }
    void onCopyLink();
  }

  if (live) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <p className="mb-2 text-4xl">🎉</p>
        <h1
          className="mb-3 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
        >
          Your store is live!
        </h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Share your link to start taking orders. That&apos;s the whole job now — every order lands
          in your dashboard.
        </p>
        <Card className="mb-6 flex flex-col items-center gap-4 p-6">
          <StoreQrCode url={storeUrl} />
          <p className="break-all font-mono text-sm text-foreground">{storeUrl}</p>
          <p className="text-xs text-muted-foreground">
            Scan to open your store, or share the link below.
          </p>
        </Card>
        <div className="flex flex-col gap-3">
          <a href={`/s/${store.slug}`} target="_blank" rel="noopener noreferrer">
            <Button className="w-full">View My Store</Button>
          </a>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onCopyLink}
              className="rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground hover:bg-secondary"
            >
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <button
              type="button"
              onClick={onShare}
              className="rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground hover:bg-secondary"
            >
              Share
            </button>
          </div>
          <Link
            href="/dashboard"
            className="w-full rounded-xl px-6 py-3 text-center text-sm font-semibold text-muted-foreground"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1
          className="mb-2 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
        >
          {progress.mandatoryComplete ? 'Your store is ready' : "Your store isn't ready yet"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {progress.mandatoryComplete
            ? 'Review the checklist, then launch. Anything optional you skipped, you can add later from Settings.'
            : `${missingRequired.length} thing${missingRequired.length === 1 ? '' : 's'} still need${missingRequired.length === 1 ? 's' : ''} your attention.`}
        </p>
      </div>

      <Card className="mb-6 divide-y divide-border p-0">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-3 p-4">
            <div
              className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
                item.done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              <Icon i={item.done ? 'check' : 'alert-circle'} size={13} />
            </div>
            <span className="flex-1 text-sm font-medium text-foreground">
              {item.label}
              {!item.required && !item.done && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">(optional)</span>
              )}
            </span>
            {!item.done && item.route && (
              <Link href={item.route} className="text-xs font-semibold text-primary">
                {item.required ? 'Fix this →' : 'Add →'}
              </Link>
            )}
          </div>
        ))}
      </Card>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <Button
        onClick={onLaunch}
        disabled={!progress.mandatoryComplete || launching}
        className="sm:px-10"
      >
        {launching ? 'Launching…' : 'Launch My Store'}
      </Button>
      {!progress.mandatoryComplete && (
        <p className="mt-3 text-xs text-muted-foreground">Add a product to unlock this.</p>
      )}
    </div>
  );
}
