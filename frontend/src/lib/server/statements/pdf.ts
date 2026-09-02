// Renders a StatementData snapshot to a PDF Buffer with pdfkit. Deterministic:
// GET /api/statements/[id]/pdf calls this on every download rather than
// storing the binary. pdfkit is in `serverExternalPackages` (next.config.ts)
// so Next doesn't bundle it — its embedded .afm font metrics load from
// node_modules at runtime.
import 'server-only';
import PDFDocument from 'pdfkit';
import type { StatementData } from './types';

const PAGE_MARGIN = 50;
const CONTENT_WIDTH = 595.28 - PAGE_MARGIN * 2; // A4 width - margins

function usd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function dateTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const SETTLEMENT_NOTE: Record<string, string> = {
  vendylio: '',
  seller_stripe: 'Paid to your Stripe account — not part of this payout.',
  seller_direct: 'Received directly by you — not part of this payout.',
};

export function renderStatementPdf(data: StatementData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = PAGE_MARGIN;
    const right = PAGE_MARGIN + CONTENT_WIDTH;

    const hr = (): void => {
      doc.moveDown(0.4);
      doc.strokeColor('#d4d4d4').lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
      doc.moveDown(0.4);
    };

    // ── Header ──────────────────────────────────────────────────────────
    doc.fillColor('#16322d').font('Helvetica-Bold').fontSize(20).text('Payout Statement');
    doc.moveDown(0.2);
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(12).text(data.storeName);
    doc
      .fillColor('#666666')
      .font('Helvetica')
      .fontSize(9)
      .text(`Period  ${dateLabel(data.periodFrom)}  —  ${dateLabel(data.periodTo)}`)
      .text(`Generated  ${dateTimeLabel(data.generatedAt)}`)
      .text(`Currency  ${data.currency}`);
    hr();

    // ── Section 1: activity for the period ──────────────────────────────
    doc
      .fillColor('#111111')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('1 · Activity for this period');
    doc
      .fillColor('#666666')
      .font('Helvetica')
      .fontSize(8.5)
      .text(
        'Every order paid between the dates above, grouped by how the buyer paid. ' +
          'This is a record of activity — not a direct calculation of the payout below.',
      );
    doc.moveDown(0.6);

    // column x-offsets
    const cGross = right - 260;
    const cComm = right - 165;
    const cNet = right - 70;
    const tableRow = (
      c0: string,
      c1: string,
      c2: string,
      c3: string,
      opts: { bold?: boolean; color?: string; size?: number } = {},
    ): void => {
      const y = doc.y;
      doc
        .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts.size ?? 9)
        .fillColor(opts.color ?? '#111111');
      doc.text(c0, left, y, { width: cGross - left - 8 });
      const rowH = doc.y - y;
      doc.text(c1, cGross, y, { width: 85, align: 'right' });
      doc.text(c2, cComm, y, { width: 85, align: 'right' });
      doc.text(c3, cNet, y, { width: 70, align: 'right' });
      doc.y = y + Math.max(rowH, doc.currentLineHeight());
    };

    tableRow('Payment method', 'Gross', 'Commission', 'Net', {
      bold: true,
      color: '#666666',
      size: 8,
    });
    doc.moveDown(0.2);

    for (const g of data.sales) {
      tableRow(
        `${g.label}  (${g.orderCount} ${g.orderCount === 1 ? 'order' : 'orders'})`,
        usd(g.grossCents),
        g.commissionCents ? `-${usd(g.commissionCents)}` : usd(0),
        usd(g.netCents),
      );
      const note = SETTLEMENT_NOTE[g.settlement];
      if (note) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(7.5)
          .fillColor('#999999')
          .text(note, left + 10, doc.y, { width: cGross - left - 18 });
      }
      doc.moveDown(0.25);
    }
    if (data.sales.length === 0) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor('#999999')
        .text('No orders in this period.');
      doc.moveDown(0.3);
    }

    doc.strokeColor('#e5e5e5').lineWidth(0.5).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
    doc.moveDown(0.3);

    tableRow(
      `Gross sales — all methods  (${data.salesTotals.orderCount} ${
        data.salesTotals.orderCount === 1 ? 'order' : 'orders'
      })`,
      usd(data.salesTotals.grossCents),
      data.salesTotals.commissionCents ? `-${usd(data.salesTotals.commissionCents)}` : usd(0),
      usd(data.salesTotals.netCents),
      { bold: true },
    );
    doc.moveDown(0.15);
    tableRow(
      `Buyer refunds issued this period  (${data.refunds.orderCount})`,
      '',
      '',
      data.refunds.amountCents ? `-${usd(data.refunds.amountCents)}` : usd(0),
    );
    tableRow('Taxes / VAT', '', '', usd(data.taxCents));
    hr();

    // ── Section 2: this payout ──────────────────────────────────────────
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(12).text('2 · This payout');
    doc.moveDown(0.5);

    const kv = (k: string, v: string): void => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor('#666666').text(k, left, y, { width: 170 });
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#111111')
        .text(v, left + 175, y, {
          width: CONTENT_WIDTH - 175,
        });
      doc.y = Math.max(doc.y, y + doc.currentLineHeight());
      doc.moveDown(0.15);
    };
    kv('Method', data.payout.method);
    kv('Status', data.payout.status);
    kv('Requested', dateTimeLabel(data.payout.requestedAt));
    kv('Completed', data.payout.completedAt ? dateTimeLabel(data.payout.completedAt) : '—');
    doc.moveDown(0.3);

    kv('Gross debit', usd(data.payout.grossCents));
    kv(
      'Commission withheld',
      data.payout.commissionWithheldCents ? `-${usd(data.payout.commissionWithheldCents)}` : usd(0),
    );

    for (const line of data.payout.commissionLines) {
      const label =
        line.kind === 'REFUND_CREDIT'
          ? `${line.orderNumber} · refund credit · ${dateLabel(line.accruedAt)}`
          : `${line.orderNumber} · ${dateLabel(line.accruedAt)}`;
      const y = doc.y;
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#888888')
        .text(label, left + 18, y, {
          width: CONTENT_WIDTH - 100,
        });
      doc.text(`${line.amountCents < 0 ? '+' : '-'}${usd(line.amountCents)}`, right - 80, y, {
        width: 80,
        align: 'right',
      });
      doc.y = Math.max(doc.y, y + doc.currentLineHeight());
      doc.moveDown(0.1);
    }

    doc.moveDown(0.3);
    doc.strokeColor('#16322d').lineWidth(1.5).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
    doc.moveDown(0.4);

    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#16322d').text('NET PAID TO YOU', left, y);
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#16322d')
      .text(usd(data.payout.netPayableCents), right - 120, y, { width: 120, align: 'right' });
    doc.y = y + 22;

    // ── Footer ──────────────────────────────────────────────────────────
    doc.moveDown(1);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#999999')
      .text(
        'Section 1 reflects all store activity in the period. Section 2 is the amount moved in this ' +
          'payout — you withdraw a chosen amount whenever you like, so the two are not expected to match. ' +
          'Card payments made through your own Stripe account and Cash App / Zelle payments you received ' +
          'directly are shown for completeness but are not paid out by Vendylio.',
        { width: CONTENT_WIDTH },
      );
    doc.moveDown(0.5);
    doc.fillColor('#bbbbbb').text('Generated by Vendylio', { width: CONTENT_WIDTH });

    doc.end();
  });
}
