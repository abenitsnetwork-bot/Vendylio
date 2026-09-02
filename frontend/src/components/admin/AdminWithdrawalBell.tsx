'use client';

// Withdrawal bell for the admin header. Polls the pending-summary endpoint
// and shows the queue depth (PENDING + PROCESSING) as a badge, with a
// dropdown listing the most recent requests. Rows newer than the last time
// the dropdown was opened (localStorage) get a "New" tag. Read-only — every
// action still happens on /admin/withdrawals.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';

interface BellItem {
  id: string;
  storeName: string;
  storeSlug: string | null;
  amountCents: number;
  netCents: number;
  currency: string;
  status: string;
  method: string;
  provider: string;
  requestedAt: string;
}

interface Summary {
  pendingCount: number;
  processingCount: number;
  items: BellItem[];
}

const POLL_MS = 45_000;
const SEEN_KEY = 'admin-withdrawal-bell-seen';

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function readSeen(): number {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
}

export function AdminWithdrawalBell() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<number>(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api<Summary>('/api/admin/withdrawals/pending-summary')
      .then(setSummary)
      .catch(() => {
        /* transient — keep the last good value, try again next tick */
      });
  }, []);

  useEffect(() => {
    setSeenAt(readSeen());
    load();
    const t = setInterval(load, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      const now = Date.now();
      try {
        localStorage.setItem(SEEN_KEY, String(now));
      } catch {
        /* private mode — the "New" tag just won't persist */
      }
      // Defer so the dropdown still highlights what was new on this open.
      setTimeout(() => setSeenAt(now), 400);
    }
  }

  const queueDepth = summary ? summary.pendingCount + summary.processingCount : 0;
  const items = summary?.items ?? [];
  const newCount = items.filter((i) => new Date(i.requestedAt).getTime() > seenAt).length;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Withdrawal requests${queueDepth ? ` (${queueDepth} pending)` : ''}`}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <Icon i="bell" size={18} />
        {queueDepth > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-[18px] text-white ${
              newCount > 0 ? 'bg-red-500' : 'bg-amber-500'
            }`}
          >
            {queueDepth > 99 ? '99+' : queueDepth}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-bold text-foreground">Withdrawal requests</p>
            <Link
              href="/admin/withdrawals"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-accent hover:underline"
            >
              View all
            </Link>
          </div>

          {summary && (
            <div className="flex gap-4 border-b border-border px-4 py-2 text-xs text-muted-foreground">
              <span>
                <strong className="text-foreground">{summary.pendingCount}</strong> pending
              </span>
              <span>
                <strong className="text-foreground">{summary.processingCount}</strong> processing
              </span>
            </div>
          )}

          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Icon
                  i="check-circle"
                  size={24}
                  className="mx-auto mb-2 text-muted-foreground opacity-40"
                />
                <p className="text-xs text-muted-foreground">No requests to action.</p>
              </div>
            ) : (
              items.map((i) => {
                const isNew = new Date(i.requestedAt).getTime() > seenAt;
                return (
                  <Link
                    key={i.id}
                    href="/admin/withdrawals"
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-secondary"
                  >
                    <span
                      className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                        i.status === 'PENDING' ? 'bg-amber-500' : 'bg-blue-500'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {i.storeName}
                        </p>
                        <p className="flex-shrink-0 text-sm font-bold text-foreground">
                          {usd(i.netCents)}
                        </p>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {i.method} · {timeAgo(i.requestedAt)}
                        {i.status === 'PROCESSING' && ' · processing'}
                      </p>
                    </div>
                    {isNew && (
                      <span className="mt-0.5 flex-shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                        New
                      </span>
                    )}
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
