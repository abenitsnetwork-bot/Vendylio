'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { discountStatus, DISCOUNT_STATUS_LABEL, type DiscountStatus } from '@/lib/discountStatus';
import { usePlan } from '@/lib/usePlan';

export interface Discount {
  id: string;
  code: string;
  kind: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  minSubtotalCents: number;
  maxRedemptions: number | null;
  redemptionCount: number;
  createdAt: string;
}

interface DraftValues {
  code: string;
  active: boolean;
  startsAt: string; // datetime-local ("" = none)
  endsAt: string;
  minSubtotal: string; // dollars ("" = 0)
  maxRedemptions: string; // ("" = unlimited)
}

const STATUS_TONE: Record<DiscountStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  SCHEDULED: 'bg-amber-100 text-amber-700',
  EXPIRED: 'bg-secondary text-muted-foreground',
  OFF: 'bg-secondary text-muted-foreground',
  EXHAUSTED: 'bg-red-100 text-red-700',
};

/** ISO string → value a <input type="datetime-local"> accepts, in local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function draftFrom(d: Discount | null): DraftValues {
  return {
    code: d?.code ?? '',
    active: d?.active ?? true,
    startsAt: toLocalInput(d?.startsAt ?? null),
    endsAt: toLocalInput(d?.endsAt ?? null),
    minSubtotal: d && d.minSubtotalCents > 0 ? (d.minSubtotalCents / 100).toString() : '',
    maxRedemptions: d?.maxRedemptions != null ? String(d.maxRedemptions) : '',
  };
}

function draftToBody(v: DraftValues) {
  return {
    code: v.code.trim(),
    active: v.active,
    startsAt: v.startsAt ? new Date(v.startsAt).toISOString() : null,
    endsAt: v.endsAt ? new Date(v.endsAt).toISOString() : null,
    minSubtotalCents: v.minSubtotal ? Math.max(0, Math.round(Number(v.minSubtotal) * 100)) : 0,
    maxRedemptions: v.maxRedemptions ? Math.max(1, Math.trunc(Number(v.maxRedemptions))) : null,
  };
}

function windowText(d: Discount): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  if (d.startsAt && d.endsAt) return `${fmt(d.startsAt)} → ${fmt(d.endsAt)}`;
  if (d.startsAt) return `From ${fmt(d.startsAt)}`;
  if (d.endsAt) return `Until ${fmt(d.endsAt)}`;
  return 'No date limit';
}

function DiscountForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: Discount | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState<DraftValues>(() => draftFrom(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = initial !== null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!v.code.trim()) {
      setError('Give the code a name.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (editing) {
        await api(`/api/discounts/${initial.id}`, { method: 'PATCH', body: draftToBody(v) });
      } else {
        await api('/api/discounts', { method: 'POST', body: draftToBody(v) });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border border-primary bg-secondary p-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Code" htmlFor="d-code">
          <input
            id="d-code"
            className={`${inputClass} uppercase`}
            value={v.code}
            onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })}
            placeholder="FREESHIP"
            maxLength={40}
          />
        </Field>
        <Field label="Minimum cart subtotal ($, optional)" htmlFor="d-min">
          <input
            id="d-min"
            type="number"
            min="0"
            step="0.01"
            className={inputClass}
            value={v.minSubtotal}
            onChange={(e) => setV({ ...v, minSubtotal: e.target.value })}
            placeholder="0"
          />
        </Field>
        <Field label="Starts (optional)" htmlFor="d-start">
          <input
            id="d-start"
            type="datetime-local"
            className={inputClass}
            value={v.startsAt}
            onChange={(e) => setV({ ...v, startsAt: e.target.value })}
          />
        </Field>
        <Field label="Ends (optional)" htmlFor="d-end">
          <input
            id="d-end"
            type="datetime-local"
            className={inputClass}
            value={v.endsAt}
            onChange={(e) => setV({ ...v, endsAt: e.target.value })}
          />
        </Field>
        <Field label="Max uses (optional)" htmlFor="d-max">
          <input
            id="d-max"
            type="number"
            min="1"
            step="1"
            className={inputClass}
            value={v.maxRedemptions}
            onChange={(e) => setV({ ...v, maxRedemptions: e.target.value })}
            placeholder="Unlimited"
          />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={v.active}
            onChange={(e) => setV({ ...v, active: e.target.checked })}
            className="h-4 w-4"
          />
          Active
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        This code gives the customer <strong>free delivery</strong> when it&apos;s active and the
        cart clears the minimum.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create code'}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-muted-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function DiscountManager() {
  const { isPro } = usePlan();
  const [discounts, setDiscounts] = useState<Discount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function load() {
    setError(null);
    api<{ discounts: Discount[] }>('/api/discounts')
      .then((res) => setDiscounts(res.discounts))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load promo codes.'),
      );
  }

  useEffect(load, []);

  async function onToggleActive(d: Discount) {
    setBusyId(d.id);
    try {
      await api(`/api/discounts/${d.id}`, { method: 'PATCH', body: { active: !d.active } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this code.');
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(id: string) {
    setBusyId(id);
    try {
      await api(`/api/discounts/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this code.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!creating && editingId === null && isPro && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          + New promo code
        </button>
      )}

      {!creating && editingId === null && !isPro && (
        <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm">
          <p className="font-semibold text-foreground">Promo codes are a Pro feature</p>
          <p className="mt-1 text-muted-foreground">
            Offer free delivery with a code your customers enter at checkout.{' '}
            <a href="/dashboard/billing" className="font-medium text-primary">
              Upgrade to Pro
            </a>
            .
          </p>
        </div>
      )}

      {creating && (
        <DiscountForm
          initial={null}
          onCancel={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}

      {discounts === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : discounts.length === 0 && !creating ? (
        <Card className="py-12 text-center">
          <Icon i="bookmark" size={28} className="mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">
            No promo codes yet. Create one to offer free delivery.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {discounts.map((d) => {
            const status = discountStatus(d);
            if (editingId === d.id) {
              return (
                <li key={d.id}>
                  <DiscountForm
                    initial={d}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => {
                      setEditingId(null);
                      load();
                    }}
                  />
                </li>
              );
            }
            return (
              <li key={d.id}>
                <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-foreground">{d.code}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}
                      >
                        {DISCOUNT_STATUS_LABEL[status]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Free delivery · {windowText(d)}
                      {d.minSubtotalCents > 0 && ` · min $${(d.minSubtotalCents / 100).toFixed(2)}`}
                      {' · '}
                      {d.redemptionCount}
                      {d.maxRedemptions != null ? ` / ${d.maxRedemptions}` : ''} used
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={busyId === d.id}
                      onClick={() => onToggleActive(d)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                        d.active
                          ? 'border-border text-muted-foreground hover:bg-secondary'
                          : 'border-primary text-primary hover:bg-secondary'
                      }`}
                    >
                      {d.active ? 'Turn off' : 'Turn on'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(d.id)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary"
                    >
                      Edit
                    </button>
                    {confirmDeleteId === d.id ? (
                      <>
                        <button
                          type="button"
                          disabled={busyId === d.id}
                          onClick={() => onDelete(d.id)}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs font-medium text-muted-foreground"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Delete ${d.code}`}
                        onClick={() => setConfirmDeleteId(d.id)}
                        className="text-muted-foreground hover:text-red-600"
                      >
                        <Icon i="trash" size={16} />
                      </button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
