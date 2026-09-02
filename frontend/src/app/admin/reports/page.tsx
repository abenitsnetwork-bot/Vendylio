'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAdminAuth } from '@/contexts/AdminContext';
import { Icon, type IconName } from '@/components/ui/Icon';
import { KpiTile } from '@/components/admin/dashboard/KpiTile';
import { ReportPreviewModal } from '@/components/admin/ReportPreviewModal';
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

/** Per-report card icon — falls back to a generic chart glyph. */
const REPORT_ICON: Record<string, IconName> = {
  'platform-revenue': 'dollar-sign',
  payouts: 'credit-card',
  'commission-receivables': 'pie-chart',
  'gmv-sales': 'shopping-bag',
  'store-performance': 'trending-up',
  orders: 'package',
  deliveries: 'truck',
  refunds: 'arrow-down',
  'onboarding-funnel': 'rocket',
  'storefront-traffic': 'bar-chart-3',
  'business-waitlist': 'inbox',
  'admin-activity': 'shield',
  'seller-tax-summary': 'file-text',
  'suspended-accounts': 'lock',
};

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

const LAST_PREVIEW_KEY = 'admin-reports-last-preview';

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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [lastPreview, setLastPreview] = useState<string | null>(null);

  const meta = cat?.reports.find((r) => r.type === selected) ?? null;
  const range = preset === 'custom' ? custom : rangeForPreset(preset);

  useEffect(() => {
    try {
      setLastPreview(localStorage.getItem(LAST_PREVIEW_KEY));
    } catch {
      /* private mode — no-op */
    }
  }, []);

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
      .then((c) => setCat(c))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load reports.'));
  }, []);

  const runPreview = useCallback(
    (type?: string) => {
      const t = type ?? selected;
      if (!t) return;
      setLoading(true);
      setError(null);
      setReport(null);
      const qs = new URLSearchParams(query);
      qs.set('format', 'preview');
      api<ReportData>(`/api/admin/reports/${t}?${qs.toString()}`)
        .then((r) => {
          setReport(r);
          setPreviewOpen(true);
          const stamp = new Date().toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
          setLastPreview(stamp);
          try {
            localStorage.setItem(LAST_PREVIEW_KEY, stamp);
          } catch {
            /* no-op */
          }
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not build the report.'))
        .finally(() => setLoading(false));
    },
    [selected, query],
  );

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

  const periodTile = meta
    ? meta.usesDateRange
      ? preset === 'custom'
        ? `${range.from} → ${range.to}`
        : PRESET_LABELS[preset as Exclude<Preset, 'custom'>]
      : 'Snapshot'
    : '—';
  const storeTile = !meta
    ? '—'
    : !meta.usesStoreFilter
      ? 'Platform-wide'
      : storeId
        ? (cat?.stores.find((s) => s.id === storeId)?.name ?? 'One store')
        : 'All stores';

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1
          className="font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(26px, 4vw, 34px)', letterSpacing: '-0.8px' }}
        >
          Reports
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate, review and export detailed platform reports.
        </p>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* ── Stat strip ─────────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Report types"
          icon="layout-grid"
          value={String(cat?.reports.length ?? '—')}
        />
        <KpiTile label="Period" icon="calendar" value={periodTile} />
        <KpiTile label="Store scope" icon="store" value={storeTile} />
        <KpiTile label="Last preview" icon="clock" value={lastPreview ?? 'Never'} />
      </div>

      {/* ── Quick generate ────────────────────────────────────────────── */}
      <section className="mb-6 rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Icon i="bar-chart-3" size={16} className="text-accent" />
          <h2 className="font-headings text-lg font-bold text-foreground">Quick generate</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cat?.reports.map((r) => {
            const isSel = selected === r.type;
            return (
              <button
                key={r.type}
                type="button"
                onClick={() => {
                  setSelected(r.type);
                  setReport(null);
                  setPreviewOpen(false);
                  setError(null);
                }}
                className={`group flex flex-col rounded-lg border p-4 text-left transition ${
                  isSel
                    ? 'border-accent bg-accent/[0.04] ring-1 ring-accent'
                    : 'border-border bg-card hover:border-accent/40 hover:bg-secondary/40'
                }`}
              >
                <span
                  className={`mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg ${
                    isSel ? 'bg-accent text-white' : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  <Icon i={REPORT_ICON[r.type] ?? 'bar-chart-3'} size={17} />
                </span>
                <span className="text-sm font-semibold text-foreground">{r.label}</span>
                <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {r.description}
                </span>
                <span
                  className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold ${
                    isSel ? 'text-accent' : 'text-muted-foreground group-hover:text-accent'
                  }`}
                >
                  {isSel ? 'Selected' : 'Select'}
                  <Icon i="arrow-right" size={12} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Workspace: params + result ────────────────────────────────── */}
      {meta && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="font-headings text-lg font-bold text-foreground">{meta.label}</p>
              <p className="text-xs text-muted-foreground">{meta.description}</p>
            </div>
            <div className="ml-auto flex flex-wrap items-end gap-3">
              {meta.usesDateRange && (
                <>
                  <label className="text-xs font-semibold text-muted-foreground">
                    Period
                    <select
                      value={preset}
                      onChange={(e) => setPreset(e.target.value as Preset)}
                      className="mt-1 block rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
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
                        className="rounded-lg border border-border bg-input px-3 py-2 text-sm"
                      />
                      <input
                        type="date"
                        value={custom.to}
                        onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
                        className="rounded-lg border border-border bg-input px-3 py-2 text-sm"
                      />
                    </>
                  )}
                </>
              )}
              {meta.usesStoreFilter && (
                <label className="text-xs font-semibold text-muted-foreground">
                  Store
                  <select
                    value={storeId}
                    onChange={(e) => setStoreId(e.target.value)}
                    className="mt-1 block max-w-[200px] rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
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
                onClick={() => runPreview()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
              >
                <Icon i="eye" size={14} />
                {loading ? 'Building…' : 'Preview'}
              </button>
            </div>
          </div>

          {report && !previewOpen && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-secondary/30 px-4 py-3">
              <Icon i="check-circle" size={16} className="text-green-600" />
              <div className="mr-auto">
                <p className="text-sm font-semibold text-foreground">{report.title} — ready</p>
                <p className="text-xs text-muted-foreground">
                  {report.period ? report.period.label : 'Snapshot'} ·{' '}
                  {report.rows.length.toLocaleString('en-US')} rows
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95"
              >
                <Icon i="eye" size={13} />
                Open preview
              </button>
              <a
                href={exportHref('csv')}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-secondary"
              >
                <Icon i="download" size={13} />
                CSV
              </a>
              <a
                href={exportHref('pdf')}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-secondary"
              >
                <Icon i="download" size={13} />
                PDF
              </a>
            </div>
          )}

          {!report && !loading && (
            <p className="border-t border-border pt-4 text-sm text-muted-foreground">
              Set the period{meta.usesStoreFilter ? ' and store' : ''}, then hit Preview — it opens
              a print-ready view you can print or export to CSV / PDF.
            </p>
          )}
        </section>
      )}

      {report && previewOpen && (
        <ReportPreviewModal
          report={report}
          csvHref={exportHref('csv')}
          pdfHref={exportHref('pdf')}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      {!meta && (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          Pick a report above to get started.
        </p>
      )}
    </div>
  );
}
