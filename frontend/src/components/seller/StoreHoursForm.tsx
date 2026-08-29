'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export interface StoreHoursEntry {
  day: number;
  open: string;
  close: string;
}

export interface StoreOpsDetails {
  timezone: string;
  ordersPaused: boolean;
  pauseMessage: string | null;
  hours: StoreHoursEntry[];
}

// US-first (Canada/Mexico share several of these). "UTC" is the escape hatch.
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'UTC',
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface DayRow {
  enabled: boolean;
  open: string;
  close: string;
}

function rowsFromHours(hours: StoreHoursEntry[]): DayRow[] {
  return DAYS.map((_, day) => {
    const match = hours.find((h) => h.day === day);
    return match
      ? { enabled: true, open: match.open, close: match.close }
      : { enabled: false, open: '09:00', close: '17:00' };
  });
}

export function StoreHoursForm({
  ops,
  onSaved,
}: {
  ops: StoreOpsDetails;
  onSaved: (next: StoreOpsDetails) => void;
}) {
  const [timezone, setTimezone] = useState(ops.timezone);
  const [ordersPaused, setOrdersPaused] = useState(ops.ordersPaused);
  const [pauseMessage, setPauseMessage] = useState(ops.pauseMessage ?? '');
  const [rows, setRows] = useState<DayRow[]>(rowsFromHours(ops.hours));

  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timezoneOptions = useMemo(() => {
    // Keep a stored-but-unlisted zone selectable.
    return TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES];
  }, [timezone]);

  const invalidRow = rows.some(
    (r) => r.enabled && r.open >= r.close, // "HH:MM" string compare is chronological
  );

  function setRow(day: number, patch: Partial<DayRow>) {
    setRows((prev) => prev.map((r, i) => (i === day ? { ...r, ...patch } : r)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (invalidRow) {
      setError('Each open day needs a closing time later than its opening time.');
      return;
    }
    setError(null);
    setSaved(false);
    setSubmitting(true);
    const hours: StoreHoursEntry[] = rows
      .map((r, day) => ({ day, open: r.open, close: r.close, enabled: r.enabled }))
      .filter((r) => r.enabled)
      .map(({ day, open, close }) => ({ day, open, close }));
    try {
      const res = await api<{ store: StoreOpsDetails }>('/api/stores', {
        method: 'PATCH',
        body: {
          timezone,
          ordersPaused,
          pauseMessage: pauseMessage.trim() ? pauseMessage.trim() : null,
          hours,
        },
      });
      onSaved({
        timezone: res.store.timezone,
        ordersPaused: res.store.ordersPaused,
        pauseMessage: res.store.pauseMessage,
        hours: res.store.hours,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <Card className="p-8">
        <h2 className="mb-1 font-headings text-lg font-bold text-foreground">Accepting orders</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          Pause to stop taking new orders immediately — your storefront stays visible, but customers
          can’t check out. Orders already in progress aren’t affected.
        </p>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={ordersPaused}
            onChange={(e) => setOrdersPaused(e.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span className="text-sm font-medium text-foreground">
            Pause new orders
            <span className="block text-xs font-normal text-muted-foreground">
              {ordersPaused
                ? 'Customers cannot place new orders.'
                : 'Customers can order normally.'}
            </span>
          </span>
        </label>
        {ordersPaused && (
          <div className="mt-4">
            <Field label="Message shown to customers (optional)" htmlFor="pauseMessage">
              <input
                id="pauseMessage"
                type="text"
                maxLength={200}
                value={pauseMessage}
                onChange={(e) => setPauseMessage(e.target.value)}
                placeholder="Back tomorrow at 9 AM"
                className={inputClass}
              />
            </Field>
          </div>
        )}
      </Card>

      <Card className="p-8">
        <h2 className="mb-1 font-headings text-lg font-bold text-foreground">Opening hours</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          Shown on your storefront as “currently open / closed”. This does <strong>not</strong>{' '}
          block checkout — customers can still order for later.
        </p>

        <Field label="Timezone" htmlFor="timezone">
          <select
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={inputClass}
          >
            {timezoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-5 space-y-2">
          {rows.map((row, day) => (
            <div
              key={day}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
            >
              <label className="flex w-32 items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => setRow(day, { enabled: e.target.checked })}
                  className="h-4 w-4"
                />
                {DAYS[day]}
              </label>
              {row.enabled ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={row.open}
                    onChange={(e) => setRow(day, { open: e.target.value })}
                    className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                    aria-label={`${DAYS[day]} opening time`}
                  />
                  <span className="text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={row.close}
                    onChange={(e) => setRow(day, { close: e.target.value })}
                    className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                    aria-label={`${DAYS[day]} closing time`}
                  />
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Closed</span>
              )}
            </div>
          ))}
        </div>
        {invalidRow && (
          <p className="mt-3 text-xs text-red-600">
            Each open day needs a closing time later than its opening time.
          </p>
        )}
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save changes'}
        </Button>
        {saved && (
          <span className="text-sm font-medium text-primary" role="status">
            Changes saved
          </span>
        )}
      </div>
    </form>
  );
}
