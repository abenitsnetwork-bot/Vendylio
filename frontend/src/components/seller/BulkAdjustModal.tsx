'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { Field, inputClass } from '@/components/ui/Field';

interface Row {
  productId: string;
  productName: string;
  variantId: string | null;
  variantLabel: string | null;
}

type Mode = 'increase' | 'decrease' | 'set';

export function BulkAdjustModal({
  rows,
  onClose,
  onDone,
}: {
  rows: Row[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>('increase');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<'RESTOCK' | 'MANUAL_ADJUST' | 'CORRECTION'>('RESTOCK');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) {
      setError('Enter a valid amount.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/inventory/adjust', {
        method: 'POST',
        body: {
          adjustments: rows.map((r) => ({
            productId: r.productId,
            ...(r.variantId ? { variantId: r.variantId } : {}),
            reason,
            ...(note.trim() ? { note: note.trim() } : {}),
            ...(mode === 'set' ? { newQuantity: n } : { delta: mode === 'increase' ? n : -n }),
          })),
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not apply the adjustment.');
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-headings text-lg font-bold text-foreground">
            Adjust {rows.length} item{rows.length === 1 ? '' : 's'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground"
          >
            <Icon i="x" size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Action" htmlFor="bulk-mode">
            <div className="grid grid-cols-3 gap-2">
              {(['increase', 'decrease', 'set'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold capitalize ${
                    mode === m
                      ? 'border-accent bg-secondary text-foreground'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {m === 'set' ? 'Set to' : m}
                </button>
              ))}
            </div>
          </Field>

          <Field label={mode === 'set' ? 'New quantity' : 'Amount'} htmlFor="bulk-amount">
            <input
              id="bulk-amount"
              type="number"
              min="0"
              step="0.01"
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>

          <Field label="Reason" htmlFor="bulk-reason">
            <select
              id="bulk-reason"
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
            >
              <option value="RESTOCK">Restock</option>
              <option value="MANUAL_ADJUST">Manual adjustment</option>
              <option value="CORRECTION">Correction</option>
            </select>
          </Field>

          <Field label="Note (optional)" htmlFor="bulk-note">
            <input
              id="bulk-note"
              className={inputClass}
              placeholder="e.g. supplier delivery #42"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="rounded-lg border border-border bg-secondary px-5 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
            >
              {submitting ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
