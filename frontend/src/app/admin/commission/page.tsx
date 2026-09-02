'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAdminAuth } from '@/contexts/AdminContext';
import { Icon } from '@/components/ui/Icon';

interface StoreRow {
  storeId: string;
  storeName: string;
  storeSlug: string;
  owedCents: number;
  invoicedCents: number;
  chargeCount: number;
  oldestOwedAt: string | null;
}

interface Receivables {
  totals: { owedCents: number; invoicedCents: number; storeCount: number };
  stores: StoreRow[];
}

function usd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function ageDays(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : `${days}d`;
}

export default function AdminCommissionPage() {
  const { admin } = useAdminAuth();
  const isSuperadmin = admin?.role === 'SUPERADMIN';
  const [data, setData] = useState<Receivables | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<Receivables>('/api/admin/commission-charges')
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load receivables.'),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onWaive(row: StoreRow) {
    const reason = window.prompt(
      `Write off ${usd(row.owedCents)} of outstanding commission for ${row.storeName}?\n\nReason (recorded in the audit log):`,
    );
    if (!reason) return;
    setBusyId(row.storeId);
    try {
      await api('/api/admin/commission-charges/waive', {
        method: 'POST',
        body: { storeId: row.storeId, reason },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Waive failed.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="px-4 py-8 lg:px-8">
      <h1 className="mb-1 font-headings text-2xl font-bold text-foreground">
        Commission receivables
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Cash App / Zelle marketplace commission the platform is owed. Collected by withholding from
        a withdrawal, or the daily <code>commission-settlement-sweep</code> Stripe invoice.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {data && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Owed</p>
            <p className="font-headings text-2xl font-bold text-foreground">
              {usd(data.totals.owedCents)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Invoiced</p>
            <p className="font-headings text-2xl font-bold text-foreground">
              {usd(data.totals.invoicedCents)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Stores</p>
            <p className="font-headings text-2xl font-bold text-foreground">
              {data.totals.storeCount}
            </p>
          </div>
        </div>
      )}

      {data === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && data.stores.length === 0 && (
        <div className="py-10 text-center">
          <Icon
            i="check-circle"
            size={28}
            className="mx-auto mb-3 text-muted-foreground opacity-50"
          />
          <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
        </div>
      )}

      {data && data.stores.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4">Store</th>
                <th className="py-2 pr-4 text-right">Owed</th>
                <th className="py-2 pr-4 text-right">Invoiced</th>
                <th className="py-2 pr-4 text-right">Charges</th>
                <th className="py-2 pr-4 text-right">Oldest</th>
                {isSuperadmin && <th className="py-2" />}
              </tr>
            </thead>
            <tbody>
              {data.stores.map((row) => (
                <tr key={row.storeId} className="border-b border-border/60">
                  <td className="py-3 pr-4">
                    <p className="font-medium text-foreground">{row.storeName}</p>
                    <p className="text-xs text-muted-foreground">/{row.storeSlug}</p>
                  </td>
                  <td className="py-3 pr-4 text-right font-semibold text-foreground">
                    {usd(row.owedCents)}
                  </td>
                  <td className="py-3 pr-4 text-right text-muted-foreground">
                    {usd(row.invoicedCents)}
                  </td>
                  <td className="py-3 pr-4 text-right text-muted-foreground">{row.chargeCount}</td>
                  <td className="py-3 pr-4 text-right text-muted-foreground">
                    {ageDays(row.oldestOwedAt)}
                  </td>
                  {isSuperadmin && (
                    <td className="py-3 text-right">
                      {row.owedCents > 0 && (
                        <button
                          type="button"
                          onClick={() => onWaive(row)}
                          disabled={busyId === row.storeId}
                          className="rounded border border-border px-3 py-1 text-xs font-semibold text-foreground disabled:opacity-50"
                        >
                          {busyId === row.storeId ? 'Waiving…' : 'Waive'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
