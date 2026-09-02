'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAdminAuth } from '@/contexts/AdminContext';
import { Icon } from '@/components/ui/Icon';
import { formatCell } from '@/lib/server/reports/format';
import type { ReportData } from '@/lib/server/reports/types';

interface ReportMeta {
  type: string;
  label: string;
  description: string;
  usesDateRange: boolean;
  usesStoreFilter: boolean;
}
interface Catalogue {
  reports: ReportMeta[];
  stores: { id: string; name: string }[];
}

type Preset = 'this-month' | 'last-month' | 'last-30' | 'qtd' | 'ytd' | 'custom';

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function rangeForPreset(p: Preset): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const endOfToday = new Date(Date.UTC(y, m, now.getUTCDate(), 23, 59, 59));
  switch (p) {
    case 'this-month':
      return { from: isoDay(new Date(Date.UTC(y, m, 1))), to: isoDay(endOfToday) };
    case 'last-month':
      return {
        from: isoDay(new Date(Date.UTC(y, m - 1, 1))),
        to: isoDay(new Date(Date.UTC(y, m, 1))),
      };
    case 'last-30':
      return { from: isoDay(new Date(now.getTime() - 30 * 86_400_000)), to: isoDay(endOfToday) };
    case 'qtd':
      return {
        from: isoDay(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))),
        to: isoDay(endOfToday),
      };
    case 'ytd':
      return { from: isoDay(new Date(Date.UTC(y, 0, 1))), to: isoDay(endOfToday) };
    default:
      return { from: isoDay(new Date(Date.UTC(y, m, 1))), to: isoDay(endOfToday) };
  }
}

const PRESET_LABELS: Record<Exclude<Preset, 'custom'>, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-30': 'Last 30 days',
  qtd: 'Quarter to date',
  ytd: 'Year to date',
};

export default function AdminReportsPage() {
  const { admin } = useAdminAuth();
  const isSuperadmin = admin?.role === 'SUPERADMIN';

  const [cat, setCat] = useState<Catalogue | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preset, setPreset] = useState<Preset>('this-month');
  const [custom, setCustom] = useState(rangeForPreset('this-month'));
  const [storeId, setStoreId] = useState('');
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = cat?.reports.find((r) => r.type === selected) ?? null;
  const range = preset === 'custom' ? custom : rangeForPreset(preset);

  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (meta?.usesDateRange) {
      qs.set('from', new Date(range.from).toISOString());
      qs.set('to', new Date(range.to + 'T23:59:59Z').toISOString());
    }
    if (meta?.usesStoreFilter && storeId) qs.set('storeId', storeId);
    return qs;
  }, [meta, range.from, range.to, storeId]);

  useEffect(() => {
    api<Catalogue>('/api/admin/reports')
      .then((c) => {
        setCat(c);
        setSelected((s) => s ?? c.reports[0]?.type ?? null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load reports.'));
  }, []);

  const runPreview = useCallback(() => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    setReport(null);
    const qs = new URLSearchParams(query);
    qs.set('format', 'preview');
    api<ReportData>(`/api/admin/reports/${selected}?${qs.toString()}`)
      .then(setReport)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not build the report.'))
      .finally(() => setLoading(false));
  }, [selected, query]);

  if (!admin) return null;
  if (!isSuperadmin) {
    return (
      <div className="px-4 py-8 lg:px-8">
        <p className="text-sm text-muted-foreground">Reports are SUPERADMIN-only.</p>
      </div>
    );
  }

  const exportHref = (format: 'csv' | 'pdf') => {
    const qs = new URLSearchParams(query);
    qs.set('format', format);
    return `/api/admin/reports/${selected}?${qs.toString()}`;
  };

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <h1
        className="mb-6 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
      >
        Reports
      </h1>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Report picker */}
        <div className="space-y-2">
          {cat?.reports.map((r) => (
            <button
              key={r.type}
              type="button"
              onClick={() => {
                setSelected(r.type);
                setReport(null);
              }}
              className={`w-full rounded-lg border p-3 text-left transition ${
                selected === r.type
                  ? 'border-panel bg-panel text-panel-foreground'
                  : 'border-border bg-card hover:bg-secondary'
              }`}
            >
              <p className="text-sm font-semibold">{r.label}</p>
              <p
                className={`mt-0.5 text-xs ${
                  selected === r.type ? 'text-panel-foreground/80' : 'text-muted-foreground'
                }`}
              >
                {r.description}
              </p>
            </button>
          ))}
        </div>

        {/* Params + result */}
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
            {meta?.usesDateRange && (
              <>
                <label className="text-xs font-semibold text-muted-foreground">
                  Period
                  <select
                    value={preset}
                    onChange={(e) => setPreset(e.target.value as Preset)}
                    className="mt-1 block rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                  >
                    {Object.entries(PRESET_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                    <option value="custom">Custom…</option>
                  </select>
                </label>
                {preset === 'custom' && (
                  <>
                    <input
                      type="date"
                      value={custom.from}
                      onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
                      className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    />
                    <input
                      type="date"
                      value={custom.to}
                      onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                      className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    />
                  </>
                )}
              </>
            )}
            {meta?.usesStoreFilter && (
              <label className="text-xs font-semibold text-muted-foreground">
                Store
                <select
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="mt-1 block max-w-[220px] rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                >
                  <option value="">All stores</option>
                  {cat?.stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={runPreview}
              disabled={loading}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? 'Building…' : 'Preview'}
            </button>
            {report && (
              <div className="flex gap-2">
                <a
                  href={exportHref('csv')}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-secondary"
                >
                  <Icon i="download" size={13} className="mr-1 inline" />
                  CSV
                </a>
                <a
                  href={exportHref('pdf')}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-secondary"
                >
                  <Icon i="download" size={13} className="mr-1 inline" />
                  PDF
                </a>
              </div>
            )}
          </div>

          {report && (
            <div className="space-y-4">
              <div>
                <h2 className="font-headings text-lg font-bold text-foreground">{report.title}</h2>
                {report.period && (
                  <p className="text-xs text-muted-foreground">{report.period.label}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {report.kpis.map((k) => (
                  <div key={k.label} className="rounded-lg border border-border bg-card p-3">
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                      {k.label}
                    </p>
                    <p className="mt-1 text-lg font-bold text-foreground">{k.value}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      {report.columns.map((c) => (
                        <th
                          key={c.key}
                          className={`px-3 py-2 font-semibold ${
                            c.format && c.format !== 'text' && c.format !== 'date'
                              ? 'text-right'
                              : ''
                          }`}
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={report.columns.length}
                          className="px-3 py-8 text-center text-muted-foreground"
                        >
                          No data for this period.
                        </td>
                      </tr>
                    ) : (
                      report.rows.map((row, i) => (
                        <tr key={i} className="border-b border-border last:border-b-0">
                          {report.columns.map((c) => (
                            <td
                              key={c.key}
                              className={`px-3 py-2 text-foreground ${
                                c.format && c.format !== 'text' && c.format !== 'date'
                                  ? 'text-right tabular-nums'
                                  : ''
                              }`}
                            >
                              {formatCell(row[c.key] ?? null, c.format)}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {report.notes && report.notes.length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {report.notes.map((n, i) => (
                    <li key={i}>• {n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!report && !loading && (
            <p className="text-sm text-muted-foreground">
              Pick a report and a period, then hit Preview.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
