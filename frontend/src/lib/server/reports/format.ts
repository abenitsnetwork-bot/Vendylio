// Cell formatting shared by the PDF renderer and the client preview. CSV
// never calls this — it emits the raw value so spreadsheets keep their types.
import type { ColumnFormat } from './types';

export function usd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const n = Math.abs(cents) / 100;
  return `${sign}$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCell(value: string | number | null, format: ColumnFormat = 'text'): string {
  if (value === null || value === undefined || value === '') return format === 'text' ? '' : '—';
  switch (format) {
    case 'usd':
      return typeof value === 'number' ? usd(value) : String(value);
    case 'number':
      return typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
    case 'percent':
      return typeof value === 'number' ? `${value.toFixed(1)}%` : String(value);
    case 'date':
      return typeof value === 'string' && value
        ? new Date(value).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          })
        : String(value);
    default:
      return String(value);
  }
}

/** "September 2026", "Sep 1 – Sep 30, 2026", etc. */
export function periodLabel(from: Date, to: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  };
  // `to` is exclusive — show the last included day.
  const lastDay = new Date(to.getTime() - 1);
  const f = from.toLocaleDateString('en-US', opts);
  const t = lastDay.toLocaleDateString('en-US', opts);
  return f === t ? f : `${f} – ${t}`;
}

/** UTC calendar-month key "2026-09" for grouping. */
export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
