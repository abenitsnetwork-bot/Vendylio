import 'server-only';
import type { ReportData } from './types';

function escape(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * ReportData → CSV. Raw values (numbers stay numbers, dollars stay cents-as-
 * decimal) so a spreadsheet keeps its types. A short metadata preamble names
 * the report + period; Excel-friendly UTF-8 BOM.
 */
export function reportToCsv(report: ReportData): string {
  const lines: string[] = [];
  lines.push(escape(report.title));
  if (report.period) lines.push(escape(`Period: ${report.period.label}`));
  lines.push(escape(`Generated: ${new Date(report.generatedAt).toISOString()}`));
  lines.push('');

  lines.push(report.columns.map((c) => escape(c.label)).join(','));
  for (const row of report.rows) {
    lines.push(
      report.columns
        .map((c) => {
          const v = row[c.key] ?? null;
          // Money is stored in cents on the row — emit dollars for the sheet.
          if (c.format === 'usd' && typeof v === 'number') return escape((v / 100).toFixed(2));
          return escape(v);
        })
        .join(','),
    );
  }

  if (report.notes?.length) {
    lines.push('');
    for (const n of report.notes) lines.push(escape(`Note: ${n}`));
  }

  return '﻿' + lines.join('\r\n');
}
