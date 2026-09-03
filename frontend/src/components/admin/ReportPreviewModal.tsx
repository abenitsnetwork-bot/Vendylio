'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { formatCell } from '@/lib/server/reports/format';
import type { ReportData } from '@/lib/server/reports/types';

/**
 * Full-screen "print preview" for a generated report. Renders a paper-styled
 * document (title, period, KPIs, table, notes) with a toolbar to filter rows,
 * print (browser print dialog — the scoped @media print rules isolate the
 * paper), or download the CSV / PDF export. Portalled to <body> so the print
 * isolation selector (`body > *:not(#report-preview-portal)`) is reliable.
 */
export function ReportPreviewModal({
  report,
  csvHref,
  pdfHref,
  onClose,
}: {
  report: ReportData;
  csvHref: string;
  pdfHref: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return report.rows;
    return report.rows.filter((row) =>
      report.columns.some((c) =>
        String(row[c.key] ?? '')
          .toLowerCase()
          .includes(needle),
      ),
    );
  }, [q, report]);

  if (!mounted) return null;

  const numericCol = (fmt?: string) => fmt && fmt !== 'text' && fmt !== 'date';

  return createPortal(
    <div id="report-preview-portal">
      <style>{`
        @media print {
          @page { margin: 14mm; }
          body > *:not(#report-preview-portal) { display: none !important; }
          #report-preview-portal .rp-overlay { position: static !important; background: #fff !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; padding: 0 !important; }
          #report-preview-portal .rp-no-print { display: none !important; }
          #report-preview-portal .rp-scroll { overflow: visible !important; padding: 0 !important; background: #fff !important; }
          #report-preview-portal .rp-paper { box-shadow: none !important; margin: 0 !important; max-width: none !important; width: auto !important; border: 0 !important; }
          #report-preview-portal table { font-size: 10px !important; }
          #report-preview-portal tr { break-inside: avoid; }
          #report-preview-portal thead { display: table-header-group; }
        }
      `}</style>

      <div
        className="rp-overlay fixed inset-0 z-[100] flex flex-col bg-black/55 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview — ${report.title}`}
      >
        {/* Toolbar */}
        <div className="rp-no-print flex flex-wrap items-center gap-2 border-b border-white/10 bg-panel px-4 py-2.5 text-panel-foreground">
          <Icon i="file-text" size={15} />
          <span className="mr-auto text-sm font-semibold">Preview — {report.title}</span>

          <div className="relative">
            <Icon
              i="search"
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-black/40"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter rows…"
              className="w-40 rounded-md border border-white/15 bg-white/95 py-1.5 pl-8 pr-3 text-sm text-black placeholder:text-black/40"
            />
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-95"
          >
            <Icon i="file-text" size={13} />
            Print
          </button>
          <a
            href={csvHref}
            className="inline-flex items-center gap-1 rounded-md border border-white/20 px-3 py-1.5 text-sm font-semibold text-panel-foreground hover:bg-white/10"
          >
            <Icon i="download" size={13} />
            CSV
          </a>
          <a
            href={pdfHref}
            className="inline-flex items-center gap-1 rounded-md border border-white/20 px-3 py-1.5 text-sm font-semibold text-panel-foreground hover:bg-white/10"
          >
            <Icon i="download" size={13} />
            PDF
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="ml-1 rounded-md p-1.5 text-panel-foreground/80 hover:bg-white/10 hover:text-panel-foreground"
          >
            <Icon i="x" size={16} />
          </button>
        </div>

        {/* Scrollable paper */}
        <div className="rp-scroll flex-1 overflow-auto p-6" onClick={onClose}>
          <div
            className="rp-paper mx-auto max-w-[900px] rounded-sm bg-white p-10 text-[13px] leading-relaxed text-black shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Letterhead */}
            <div className="mb-5 flex items-start justify-between border-b border-black/15 pb-4">
              <div>
                <h1 className="font-headings text-xl font-bold text-black">{report.title}</h1>
                <p className="mt-1 text-[12px] text-black/60">
                  {report.period ? report.period.label : 'Point-in-time snapshot'}
                </p>
              </div>
              <div className="text-right text-[11px] text-black/55">
                <p className="font-semibold text-black/70">Vendylio</p>
                <p>Generated {new Date(report.generatedAt).toLocaleString('en-US')}</p>
                <p>{rows.length.toLocaleString('en-US')} rows</p>
              </div>
            </div>

            {/* KPIs */}
            {report.kpis.length > 0 && (
              <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                {report.kpis.map((k) => (
                  <div key={k.label}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-black/45">
                      {k.label}
                    </p>
                    <p className="mt-0.5 font-headings text-base font-bold text-black">{k.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-y border-black/20 text-left">
                    {report.columns.map((c) => (
                      <th
                        key={c.key}
                        className={`px-2 py-1.5 font-semibold text-black/70 ${
                          numericCol(c.format) ? 'text-right' : ''
                        }`}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={report.columns.length}
                        className="px-2 py-8 text-center text-black/50"
                      >
                        {report.rows.length === 0
                          ? 'No data for this period.'
                          : 'No rows match your filter.'}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, i) => (
                      <tr key={i} className="border-b border-black/10">
                        {report.columns.map((c) => (
                          <td
                            key={c.key}
                            className={`px-2 py-1.5 align-top text-black/90 ${
                              numericCol(c.format) ? 'text-right tabular-nums' : ''
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

            {/* Notes */}
            {report.notes && report.notes.length > 0 && (
              <ul className="mt-5 space-y-1 border-t border-black/10 pt-3 text-[10.5px] text-black/55">
                {report.notes.map((n, i) => (
                  <li key={i}>• {n}</li>
                ))}
              </ul>
            )}

            <p className="mt-6 text-[10px] text-black/40">
              Generated by Vendylio · SUPERADMIN report · confidential
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
