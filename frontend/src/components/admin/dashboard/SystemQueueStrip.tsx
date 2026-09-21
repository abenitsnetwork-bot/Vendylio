import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface QueueSnapshot {
  outboxPending: number;
  outboxFailed: number;
  emailPending: number;
  emailFailed: number;
  deliveriesInFlight: number;
  withdrawalsPending: number;
}

interface Tile {
  label: string;
  value: number;
  icon: IconName;
  href?: string;
  /** > 0 turns the tile amber (attention) or red (failure). */
  tone: 'ok' | 'attention' | 'failure';
}

function tiles(q: QueueSnapshot): Tile[] {
  return [
    {
      label: 'Outbox pending',
      value: q.outboxPending,
      icon: 'inbox',
      tone: q.outboxPending > 50 ? 'attention' : 'ok',
    },
    {
      label: 'Outbox failed',
      value: q.outboxFailed,
      icon: 'alert-circle',
      tone: q.outboxFailed > 0 ? 'failure' : 'ok',
    },
    {
      label: 'Emails queued',
      value: q.emailPending,
      icon: 'mail',
      tone: q.emailPending > 50 ? 'attention' : 'ok',
    },
    {
      label: 'Emails failed',
      value: q.emailFailed,
      icon: 'alert-circle',
      tone: q.emailFailed > 0 ? 'failure' : 'ok',
    },
    {
      label: 'Deliveries in flight',
      value: q.deliveriesInFlight,
      icon: 'truck',
      tone: 'ok',
    },
    {
      label: 'Withdrawals pending',
      value: q.withdrawalsPending,
      icon: 'credit-card',
      href: '/admin/withdrawals',
      tone: q.withdrawalsPending > 0 ? 'attention' : 'ok',
    },
  ];
}

const TONE_CLASS: Record<Tile['tone'], string> = {
  ok: 'border-border bg-card',
  attention: 'border-amber-300 bg-amber-50',
  failure: 'border-red-300 bg-red-50',
};

const TONE_BADGE: Record<Tile['tone'], string> = {
  ok: 'bg-secondary text-muted-foreground',
  attention: 'bg-amber-100 text-amber-700',
  failure: 'bg-red-100 text-red-700',
};

const TONE_VALUE: Record<Tile['tone'], string> = {
  ok: 'text-foreground',
  attention: 'text-amber-700',
  failure: 'text-red-700',
};

/**
 * Same visual weight as the seller dashboard's StatCard (rounded-xl, shadow,
 * circular icon badge, big tabular value) — but the badge/value colour stays
 * driven by operational tone (ok/attention/failure), never a decorative
 * accent, so a real problem still reads as amber/red at a glance.
 */
export function SystemQueueStrip({ queue }: { queue: QueueSnapshot }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles(queue).map((t) => {
        const inner = (
          <>
            <div className="mb-2.5 flex items-center gap-2.5">
              <span
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${TONE_BADGE[t.tone]}`}
              >
                <Icon i={t.icon} size={16} />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t.label}
              </span>
            </div>
            <p className={`font-headings text-2xl font-bold tabular-nums ${TONE_VALUE[t.tone]}`}>
              {t.value}
            </p>
          </>
        );
        const cls = `block rounded-xl border p-4 shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${TONE_CLASS[t.tone]}`;
        return t.href ? (
          <Link key={t.label} href={t.href} className={cls}>
            {inner}
          </Link>
        ) : (
          <div key={t.label} className={cls}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
