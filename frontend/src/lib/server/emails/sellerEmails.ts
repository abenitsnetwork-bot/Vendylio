// Prompt #15 — operational emails for the STORE OWNER (not the buyer).
//
// Kept separate from orderEmails.ts on purpose: that file is "the ONLY emails a
// guest buyer receives". These go to the merchant so they can act on an order
// without watching the dashboard (NOTIF-01) and get a single nudge if a paid
// order sits untouched (ORD-01).
//
// Rendered from NORMALISED data prepared by sellerOrderEmailContext.ts — no DB
// work here. Every interpolated value flows through htmlEscape (store, product
// and customer names are all user-controlled).
import 'server-only';

export interface SellerEmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface SellerOrderEmailItem {
  name: string;
  quantity: number;
  unitLabel?: string | undefined;
  lineTotalCents: number;
}

export interface SellerOrderEmailContext {
  storeName: string;
  orderReference: string; // "VND-10042"
  dashboardUrl: string; // absolute link to the merchant's order detail page
  customerName?: string | null;
  /** Fulfillment-critical contact — the merchant needs it to coordinate. */
  customerPhone?: string | null;
  fulfillmentMethod: 'PICKUP' | 'DELIVERY';
  /** Formatted one-line delivery address, when the order is for delivery. */
  deliveryAddress?: string | null;
  items: SellerOrderEmailItem[];
  totalCents: number;
  currency: string;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2);
  return currency === 'USD' ? `$${amount}` : `${amount} ${htmlEscape(currency)}`;
}

function itemsHtml(ctx: SellerOrderEmailContext): string {
  const rows = ctx.items
    .map((it) => {
      const qty =
        it.unitLabel && it.unitLabel !== 'UNIT'
          ? `${it.quantity} ${htmlEscape(it.unitLabel.toLowerCase())}`
          : `×${it.quantity}`;
      return `<tr>
        <td style="padding:6px 0;color:#111;">${htmlEscape(it.name)} <span style="color:#666;">${qty}</span></td>
        <td style="padding:6px 0;color:#111;text-align:right;white-space:nowrap;">${money(it.lineTotalCents, ctx.currency)}</td>
      </tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:16px 0;">
    ${rows}
    <tr><td colspan="2" style="border-top:1px solid #e5e5e5;padding-top:10px;"></td></tr>
    <tr>
      <td style="padding:2px 0;color:#111;font-weight:600;">Order total</td>
      <td style="padding:2px 0;color:#111;font-weight:600;text-align:right;">${money(ctx.totalCents, ctx.currency)}</td>
    </tr>
  </table>`;
}

function itemsText(ctx: SellerOrderEmailContext): string {
  const lines = ctx.items.map((it) => {
    const qty =
      it.unitLabel && it.unitLabel !== 'UNIT'
        ? `${it.quantity} ${it.unitLabel.toLowerCase()}`
        : `x${it.quantity}`;
    return `  - ${it.name} ${qty}  ${money(it.lineTotalCents, ctx.currency)}`;
  });
  lines.push(`  Order total: ${money(ctx.totalCents, ctx.currency)}`);
  return lines.join('\n');
}

function fulfillmentLineHtml(ctx: SellerOrderEmailContext): string {
  if (ctx.fulfillmentMethod === 'PICKUP') {
    return `<p style="font-size:14px;margin:8px 0 0;color:#111;"><strong>Pickup</strong> — the customer will collect this order in person.</p>`;
  }
  const addr = ctx.deliveryAddress ? ` to <strong>${htmlEscape(ctx.deliveryAddress)}</strong>` : '';
  return `<p style="font-size:14px;margin:8px 0 0;color:#111;"><strong>Delivery</strong>${addr}.</p>`;
}

function contactLineHtml(ctx: SellerOrderEmailContext): string {
  const bits: string[] = [];
  if (ctx.customerName && ctx.customerName.trim()) bits.push(htmlEscape(ctx.customerName.trim()));
  if (ctx.customerPhone && ctx.customerPhone.trim())
    bits.push(htmlEscape(ctx.customerPhone.trim()));
  if (!bits.length) return '';
  return `<p style="font-size:14px;margin:8px 0 0;color:#111;">Customer: ${bits.join(' · ')}</p>`;
}

function shell(opts: {
  ctx: SellerOrderEmailContext;
  heading: string;
  intro: string;
  ctaLabel: string;
}): string {
  const { ctx } = opts;
  const store = htmlEscape(ctx.storeName);
  const ref = htmlEscape(ctx.orderReference);
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
    <p style="font-size:13px;color:#666;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.04em;">${store}</p>
    <h1 style="font-size:20px;margin:0 0 4px;">${htmlEscape(opts.heading)}</h1>
    <p style="font-size:14px;color:#666;margin:0 0 16px;">Order ${ref}</p>
    <p style="font-size:14px;line-height:1.5;margin:0;">${htmlEscape(opts.intro)}</p>
    ${contactLineHtml(ctx)}
    ${fulfillmentLineHtml(ctx)}
    ${itemsHtml(ctx)}
    <p style="margin:24px 0;">
      <a href="${htmlEscape(ctx.dashboardUrl)}" style="background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600;">${htmlEscape(opts.ctaLabel)}</a>
    </p>
    <p style="color:#999;font-size:12px;margin:24px 0 0;">You're receiving this because you own ${store} on Vendylio. Manage order emails in your dashboard notification settings.</p>
  </div>`;
}

function textShell(opts: {
  ctx: SellerOrderEmailContext;
  heading: string;
  intro: string;
  ctaLabel: string;
}): string {
  const { ctx } = opts;
  const parts = [
    `${ctx.storeName} — ${opts.heading}`,
    `Order ${ctx.orderReference}`,
    '',
    opts.intro,
  ];
  if (ctx.customerName || ctx.customerPhone) {
    parts.push(`Customer: ${[ctx.customerName, ctx.customerPhone].filter(Boolean).join(' · ')}`);
  }
  parts.push(
    ctx.fulfillmentMethod === 'PICKUP'
      ? 'Pickup — the customer will collect this order in person.'
      : `Delivery${ctx.deliveryAddress ? ` to ${ctx.deliveryAddress}` : ''}.`,
  );
  parts.push('', itemsText(ctx), '', `${opts.ctaLabel}: ${ctx.dashboardUrl}`);
  return parts.join('\n');
}

/** NOTIF-01 — sent from markPaid once payment is authoritative. */
export function orderNewSellerEmail(ctx: SellerOrderEmailContext): SellerEmailTemplate {
  const heading = 'New order received';
  const intro = 'You just received a paid order. Open it in your dashboard to start preparing it.';
  const ctaLabel = 'View order';
  return {
    subject: `New order ${ctx.orderReference} — ${money(ctx.totalCents, ctx.currency)}`,
    html: shell({ ctx, heading, intro, ctaLabel }),
    text: textShell({ ctx, heading, intro, ctaLabel }),
  };
}

/** ORD-01 — sent once from the order-nudge cron when a paid order sits untouched. */
export function orderUnfulfilledReminderEmail(
  ctx: SellerOrderEmailContext,
  hoursWaiting: number,
): SellerEmailTemplate {
  const heading = 'An order is still waiting';
  const intro = `Order ${ctx.orderReference} has been paid for about ${hoursWaiting} hours and hasn't been moved forward yet. If you're on it, mark it as preparing so the customer sees progress.`;
  const ctaLabel = 'Open the order';
  return {
    subject: `Reminder: order ${ctx.orderReference} is still waiting`,
    html: shell({ ctx, heading, intro, ctaLabel }),
    text: textShell({ ctx, heading, intro, ctaLabel }),
  };
}
