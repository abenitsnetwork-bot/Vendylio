'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useOnboarding } from '../layout';
import type { OnboardingStore } from '../layout';

interface ChecklistItem {
  label: string;
  done: boolean;
  route?: string;
}

export default function LaunchStepPage() {
  const { store, progress } = useOnboarding();
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!store) return null;

  const items: ChecklistItem[] = [
    { label: 'Business information', done: progress.hasStore },
    { label: 'Store name & link', done: progress.hasStore },
    { label: 'At least one product', done: progress.productsReady, route: '/onboarding/products' },
    { label: 'Store branding', done: progress.brandCustomized, route: '/onboarding/brand' },
    { label: 'Payments', done: progress.paymentsReady, route: '/onboarding/payments' },
    { label: 'Delivery', done: progress.deliveryReady, route: '/onboarding/delivery' },
  ];
  const missingRequired = items.filter((i) => !i.done && i.label === 'At least one product');

  const storeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/s/${store.slug}`
      : `/s/${store.slug}`;

  async function onLaunch() {
    setError(null);
    setLaunching(true);
    try {
      // Never trust locally-cached progress for the final gate — re-check
      // against a fresh server read right before celebrating.
      const res = await api<{ store: OnboardingStore; stats: { productCount: number } }>(
        '/api/stores/me',
      );
      if (res.stats.productCount < 1) {
        setError('You still need at least one product before launching.');
        return;
      }
      setLaunched(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify your store. Try again.');
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

  if (launched) {
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
          Congratulations! Your store is ready to share with customers.
        </p>
        <Card className="mb-6 p-4">
          <p className="break-all font-mono text-sm text-foreground">{storeUrl}</p>
        </Card>
        <div className="flex flex-col gap-3">
          <a href={`/s/${store.slug}`} target="_blank" rel="noopener noreferrer">
            <Button className="w-full">View My Store</Button>
          </a>
          <button
            type="button"
            onClick={onCopyLink}
            className="w-full rounded-xl border border-border px-6 py-3 text-sm font-semibold text-foreground hover:bg-secondary"
          >
            {copied ? 'Copied!' : 'Copy Store Link'}
          </button>
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
            ? 'Everything looks good — launch when you are.'
            : `${missingRequired.length} thing${missingRequired.length === 1 ? '' : 's'} still need${missingRequired.length === 1 ? 's' : ''} attention.`}
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
            <span className="flex-1 text-sm font-medium text-foreground">{item.label}</span>
            {!item.done && item.route && (
              <Link href={item.route} className="text-xs font-semibold text-primary">
                Fix this →
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
        {launching ? 'Checking…' : 'Launch My Store'}
      </Button>
    </div>
  );
}
