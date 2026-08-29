'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

const COUNT_POLL_MS = 30_000;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function orderIdOf(n: Notification): string | null {
  if (n.data && typeof n.data === 'object' && 'orderId' in n.data) {
    const id = (n.data as { orderId?: unknown }).orderId;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

/**
 * Wires the existing notifications API (GET /api/notifications,
 * GET /api/notifications/count, PATCH /api/notifications) to the header bell
 * for the first time — the routes shipped with no UI. New paid orders arrive
 * as ORDER_PAID notifications (see markPaid.ts → outbox → orderPaid template),
 * so this is where a seller sees "New order paid" land.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    api<{ count: number }>('/api/notifications/count')
      .then((r) => setUnread(r.count))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, COUNT_POLL_MS);
    return () => clearInterval(t);
  }, [refreshCount]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setItems(null);
      api<{ items: Notification[] }>('/api/notifications?limit=20')
        .then((r) => setItems(r.items))
        .catch(() => setItems([]));
    }
  }

  async function markAllRead() {
    setItems(
      (prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? prev,
    );
    setUnread(0);
    try {
      await api('/api/notifications', { method: 'PATCH', body: { ids: 'all' } });
    } catch {
      refreshCount();
    }
  }

  async function openNotification(n: Notification) {
    setOpen(false);
    if (!n.readAt) {
      setUnread((u) => Math.max(0, u - 1));
      api('/api/notifications', { method: 'PATCH', body: { ids: [n.id] } }).catch(() => {});
    }
    const orderId = orderIdOf(n);
    if (orderId) router.push(`/dashboard/orders/${orderId}`);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="relative flex items-center text-muted-foreground hover:text-foreground"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
      >
        <Icon i="bell" size={18} />
        {unread > 0 && (
          <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items === null ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Icon
                  i="inbox"
                  size={28}
                  className="mx-auto mb-2 text-muted-foreground opacity-50"
                />
                <p className="text-sm text-muted-foreground">No notifications yet.</p>
              </div>
            ) : (
              items.map((n) => {
                const clickable = orderIdOf(n) !== null;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => openNotification(n)}
                    disabled={!clickable && !!n.readAt}
                    className={`flex w-full gap-3 border-b border-border px-4 py-3 text-left last:border-b-0 ${
                      clickable ? 'hover:bg-secondary' : ''
                    } ${n.readAt ? '' : 'bg-secondary/50'}`}
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                        n.readAt ? 'bg-transparent' : 'bg-primary'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">{n.title}</span>
                      <span className="block text-xs text-muted-foreground">{n.body}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {relativeTime(n.createdAt)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
