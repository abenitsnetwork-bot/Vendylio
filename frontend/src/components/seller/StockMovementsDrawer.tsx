'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';

interface Movement {
  id: string;
  delta: number;
  resultingQuantity: number;
  reason: string;
  note: string | null;
  orderId: string | null;
  actorType: string;
  createdAt: string;
  variantLabel: string | null;
}

const REASON_LABEL: Record<string, string> = {
  SALE: 'Sale',
  RESTOCK: 'Restock',
  MANUAL_ADJUST: 'Manual adjustment',
  CORRECTION: 'Correction',
  REFUND_RESTOCK: 'Refund — restocked',
};

export function StockMovementsDrawer({
  productId,
  productName,
  onClose,
}: {
  productId: string;
  productName: string;
  onClose: () => void;
}) {
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ movements: Movement[]; nextCursor: string | null }>(
      `/api/products/${productId}/stock-movements`,
    )
      .then((res) => {
        setMovements(res.movements);
        setNextCursor(res.nextCursor);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load the history.');
      });
  }, [productId]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api<{ movements: Movement[]; nextCursor: string | null }>(
        `/api/products/${productId}/stock-movements?cursor=${encodeURIComponent(nextCursor)}`,
      );
      setMovements((prev) => [...(prev ?? []), ...res.movements]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-headings text-base font-bold text-foreground">Stock history</h2>
            <p className="text-xs text-muted-foreground">{productName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground"
          >
            <Icon i="x" size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && movements === null && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {!error && movements?.length === 0 && (
            <p className="text-sm text-muted-foreground">No movements yet.</p>
          )}
          <ul className="space-y-3">
            {movements?.map((m) => (
              <li key={m.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">
                    {REASON_LABEL[m.reason] ?? m.reason}
                  </span>
                  <span
                    className={`text-sm font-bold ${m.delta < 0 ? 'text-red-600' : 'text-green-700'}`}
                  >
                    {m.delta > 0 ? '+' : ''}
                    {m.delta}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  → {m.resultingQuantity} in stock · {new Date(m.createdAt).toLocaleString()}
                </p>
                {m.variantLabel && (
                  <p className="text-xs text-muted-foreground">{m.variantLabel}</p>
                )}
                {m.note && <p className="mt-1 text-xs text-foreground">{m.note}</p>}
                {m.orderId && (
                  <p className="mt-1 text-xs text-muted-foreground">Order {m.orderId}</p>
                )}
              </li>
            ))}
          </ul>
          {nextCursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-4 w-full rounded-lg border border-border py-2 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
