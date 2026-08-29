'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/Icon';
import type { OnboardingProgress } from '@/lib/onboardingProgress';

interface ChecklistRow {
  route: string;
  label: string;
  done: boolean;
  /** Only Business/Store and Products currently gate Launch. */
  required: boolean;
}

function rowsFor(progress: OnboardingProgress): ChecklistRow[] {
  return [
    {
      route: '/onboarding/business',
      label: 'Business & store',
      done: progress.hasStore,
      required: true,
    },
    { route: '/onboarding/brand', label: 'Brand', done: progress.brandCustomized, required: false },
    {
      route: '/onboarding/products',
      label: 'Products',
      done: progress.productsReady,
      required: true,
    },
    {
      route: '/onboarding/payments',
      label: 'Payments',
      done: progress.paymentsReady,
      required: false,
    },
    {
      route: '/onboarding/delivery',
      label: 'Delivery',
      done: progress.deliveryReady,
      required: false,
    },
    {
      route: '/onboarding/launch',
      label: 'Launch',
      done: progress.mandatoryComplete,
      required: true,
    },
  ];
}

function StepBadge({
  done,
  current,
  required,
}: {
  done: boolean;
  current: boolean;
  required: boolean;
}) {
  if (done) {
    return (
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Icon i="check" size={13} />
      </div>
    );
  }
  if (current) {
    return (
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-primary bg-card" />
    );
  }
  if (!required) {
    return (
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-border bg-card" />
    );
  }
  return (
    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
      <Icon i="alert-circle" size={13} />
    </div>
  );
}

/** Compact "Step N of M" bar for mobile — sits full-width above the page content. */
export function OnboardingMobileBar({
  progress,
  pathname,
}: {
  progress: OnboardingProgress;
  pathname: string;
}) {
  const rows = rowsFor(progress);
  const currentIndex = Math.max(
    rows.findIndex((r) => r.route === pathname),
    0,
  );

  return (
    <div className="border-b border-border bg-card px-4 py-4 lg:hidden">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Step {currentIndex + 1} of {rows.length} · {rows[currentIndex]?.label}
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${((currentIndex + 1) / rows.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

/** Full checklist sidebar for desktop — meant to sit alongside the page content in a flex row. */
export function OnboardingSidebar({
  progress,
  pathname,
}: {
  progress: OnboardingProgress;
  pathname: string;
}) {
  const rows = rowsFor(progress);
  const doneCount = rows.filter((r) => r.done).length;

  return (
    <nav aria-label="Onboarding progress" className="hidden w-64 flex-shrink-0 lg:block">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Your store setup
      </p>
      <p className="mb-6 text-xs text-muted-foreground">
        {doneCount} of {rows.length} completed
      </p>
      <ol className="space-y-1">
        {rows.map((row) => {
          const isCurrent = row.route === pathname;
          const reachable = row.route === '/onboarding/business' || progress.hasStore;
          const content = (
            <div
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm',
                isCurrent && 'bg-secondary font-semibold text-foreground',
                !isCurrent && row.done && 'text-foreground',
                !isCurrent && !row.done && 'text-muted-foreground',
              )}
            >
              <StepBadge done={row.done} current={isCurrent} required={row.required} />
              <span>{row.label}</span>
              {isCurrent && (
                <span className="ml-auto text-xs font-normal text-primary">You&apos;re here</span>
              )}
            </div>
          );
          return (
            <li key={row.route}>
              {reachable ? (
                <Link href={row.route}>{content}</Link>
              ) : (
                <div className="cursor-not-allowed opacity-50">{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
