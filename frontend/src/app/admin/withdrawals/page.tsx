'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAdminAuth } from '@/contexts/AdminContext';
import { Icon } from '@/components/ui/Icon';
import { formatUsd } from '@/components/seller/OrdersTable';

interface AdminWithdrawal {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: string;
  destination: { method?: string; cashtag?: string; contact?: string };
  provider: string;
  failureReason: string | null;
  requestedAt: string;
  completedAt: string | null;
}

const STATUS_FILTERS = ['', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];
const CANCELLABLE = new Set(['PENDING', 'PROCESSING']);
const COMPLETABLE = new Set(['PENDING', 'PROCESSING']);

function destinationLabel(d: AdminWithdrawal['destination']): string {
  if (d.method === 'CASH_APP') return `Cash App ${d.cashtag ?? ''}`.trim();
  if (d.method === 'ZELLE') return `Zelle ${d.contact ?? ''}`.trim();
  return d.method ?? 'Unknown method';
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export default function AdminWithdrawalsPage() {
  const { can } = useAdminAuth();
  // Reuses the existing 'withdrawals:cancel' capability rather than adding a
  // new one — the SUPERADMIN capability list returned by GET /api/admin/me
  // is a locked contract (D-ADMIN-04, enforced by a test asserting exactly
  // 11 entries), and "mark this manual payout as sent" is the same class of
  // financially-terminal, SUPERADMIN-only action as cancelling one.
  const canManageWithdrawals = can.includes('withdrawals:cancel');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<AdminWithdrawal[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback((filterStatus: string) => {
    setItems(null);
    setCursor(null);
    setError(null);
    const qs = filterStatus ? `?status=${filterStatus}` : '';
    api<{ items: AdminWithdrawal[]; nextCursor: string | null }>(`/api/admin/withdrawals${qs}`)
      .then((res) => {
        setItems(res.items);
        setCursor(res.nextCursor);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load withdrawals.'),
      );
  }, []);

  useEffect(() => {
    load(status);
  }, [status, load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ cursor });
      if (status) qs.set('status', status);
      const res = await api<{ items: AdminWithdrawal[]; nextCursor: string | null }>(
        `/api/admin/withdrawals?${qs.toString()}`,
      );
      setItems((prev) => [...(prev ?? []), ...res.items]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more withdrawals.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function cancel(id: string) {
    const reason = window.prompt('Reason for cancelling this withdrawal?');
    if (!reason) return;
    setBusyId(id);
    try {
      await api(`/api/admin/withdrawals/${id}/cancel`, { method: 'POST', body: { reason } });
      load(status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel this withdrawal.');
    } finally {
      setBusyId(null);
    }
  }

  async function complete(id: string) {
    if (
      !window.confirm('Confirm you already sent this payout (Cash App/Zelle) outside Vendylio?')
    ) {
      return;
    }
    setBusyId(id);
    try {
      await api(`/api/admin/withdrawals/${id}/complete`, { method: 'POST', body: {} });
      load(status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete this withdrawal.');
    } finally {
      setBusyId(null);
    }
  }

  async function sendTransfer(id: string) {
    if (
      !window.confirm(
        'Fire a Stripe Connect transfer to the seller for this bank/ACH payout? This moves real money.',
      )
    ) {
      return;
    }
    setBusyId(id);
    try {
      await api(`/api/admin/withdrawals/${id}/send-transfer`, { method: 'POST', body: {} });
      load(status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send this transfer.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <h1
        className="mb-6 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
      >
        Withdrawals
      </h1>

      <div className="mb-6 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${
              status === s
                ? 'border-panel bg-panel text-panel-foreground'
                : 'border-border bg-card text-foreground hover:bg-secondary'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && items === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!error && items !== null && items.length === 0 && (
        <div className="py-16 text-center">
          <Icon
            i="credit-card"
            size={32}
            className="mx-auto mb-4 text-muted-foreground opacity-50"
          />
          <p className="text-sm text-muted-foreground">No withdrawals match this filter.</p>
        </div>
      )}
      {items && items.length > 0 && (
        <>
          <div className="space-y-2">
            {items.map((w) => (
              <div
                key={w.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {destinationLabel(w.destination)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(w.requestedAt).toLocaleString()}
                    {w.failureReason ? ` · ${w.failureReason}` : ''}
                  </p>
                </div>
                <p className="w-20 flex-shrink-0 text-right text-sm font-bold text-foreground">
                  {formatUsd(w.amount)}
                </p>
                <span
                  className={`w-28 flex-shrink-0 rounded px-3 py-1 text-center text-xs font-semibold ${
                    STATUS_STYLES[w.status] ?? 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {w.status}
                </span>
                {canManageWithdrawals &&
                  w.provider === 'stripe_transfer' &&
                  w.status === 'PENDING' && (
                    <button
                      type="button"
                      disabled={busyId === w.id}
                      onClick={() => sendTransfer(w.id)}
                      className="flex-shrink-0 rounded-lg border border-accent bg-white px-3 py-1.5 text-xs font-semibold text-accent disabled:opacity-50"
                    >
                      Send transfer
                    </button>
                  )}
                {canManageWithdrawals && COMPLETABLE.has(w.status) && (
                  <button
                    type="button"
                    disabled={busyId === w.id}
                    onClick={() => complete(w.id)}
                    className="flex-shrink-0 rounded-lg border border-green-200 bg-white px-3 py-1.5 text-xs font-semibold text-green-700 disabled:opacity-50"
                  >
                    Mark as Sent
                  </button>
                )}
                {canManageWithdrawals && CANCELLABLE.has(w.status) && (
                  <button
                    type="button"
                    disabled={busyId === w.id}
                    onClick={() => cancel(w.id)}
                    className="flex-shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
          {cursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-6 w-full rounded-lg border border-border bg-card py-3 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
