// Phase 7 — branded transactional order emails.
//
// These are the ONLY emails a guest buyer receives. They are rendered from
// NORMALIZED data (§189) — never a raw Order row, never a provider payload —
// prepared by the caller (markPaid / status routes / refund route) and passed
// through the outbox. Rendering does no DB work (§235).
//
// Security: EVERY interpolated value flows through htmlEscape (§164/§165/§166)
// — store names, product names and customer names are all user-controlled.
// The "Track your order" link carries the high-entropy trackingToken, never
// the cuid id or the sequential order number (§114).
import 'server-only';

export interface OrderEmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface OrderEmailItem {
  name: string;
  quantity: number;
  /** productUnits unit code, e.g. "UNIT" | "LB" — display only. */
  unitLabel?: string | undefined;
  lineTotalCents: number;
}

export interface OrderEmailContext {
  storeName: string;
  orderReference: string; // "VND-10042"
  trackingUrl: string; // absolute, carries the trackingToken
  customerName?: string | null;
  fulfillmentMethod: 'PICKUP' | 'DELIVERY';
  items: OrderEmailItem[];
  totalCents: number;
  currency: string;
  /** Storefront contact number, when the store configured one (§61). */
  storePhone?: string | null;
  /** Absolute URL back to the storefront (§139). */
  storeUrl?: string | null;
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

function greeting(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed ? `Hi ${htmlEscape(trimmed)},` : 'Hi there,';
}

function itemsTableHtml(ctx: OrderEmailContext): string {
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
      <td style="padding:2px 0;color:#111;font-weight:600;">Total</td>
      <td style="padding:2px 0;color:#111;font-weight:600;text-align:right;">${money(ctx.totalCents, ctx.currency)}</td>
    </tr>
  </table>`;
}

function itemsTextLines(ctx: OrderEmailContext): string {
  const lines = ctx.items.map((it) => {
    const qty =
      it.unitLabel && it.unitLabel !== 'UNIT'
        ? `${it.quantity} ${it.unitLabel.toLowerCase()}`
        : `x${it.quantity}`;
    return `  - ${it.name} ${qty}  ${money(it.lineTotalCents, ctx.currency).replace(/<[^>]+>/g, '')}`;
  });
  lines.push(`  Total: ${money(ctx.totalCents, ctx.currency).replace(/<[^>]+>/g, '')}`);
  return lines.join('\n');
}

function shell(opts: {
  ctx: OrderEmailContext;
  heading: string;
  body: string;
  showSummary: boolean;
  showCta: boolean;
}): string {
  const { ctx } = opts;
  const store = htmlEscape(ctx.storeName);
  const ref = htmlEscape(ctx.orderReference);
  const cta = opts.showCta
    ? `<p style="margin:24px 0;">
         <a href="${htmlEscape(ctx.trackingUrl)}" style="background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600;">Track your order</a>
       </p>`
    : '';
  const summary = opts.showSummary ? itemsTableHtml(ctx) : '';
  const contactBits: string[] = [];
  if (ctx.storeUrl) {
    contactBits.push(
      `<a href="${htmlEscape(ctx.storeUrl)}" style="color:#666;">Visit ${store}</a>`,
    );
  }
  if (ctx.storePhone && ctx.storePhone.trim()) {
    contactBits.push(`Call ${htmlEscape(ctx.storePhone.trim())}`);
  }
  const contact = contactBits.length
    ? `<p style="color:#666;font-size:13px;margin:16px 0 0;">Need help with your order? ${contactBits.join(' &nbsp;·&nbsp; ')}</p>`
    : `<p style="color:#666;font-size:13px;margin:16px 0 0;">Need help with your order? Contact ${store}.</p>`;

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
    <p style="font-size:13px;color:#666;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.04em;">${store}</p>
    <h1 style="font-size:20px;margin:0 0 4px;">${htmlEscape(opts.heading)}</h1>
    <p style="font-size:14px;color:#666;margin:0 0 16px;">Order ${ref}</p>
    <p style="font-size:14px;line-height:1.5;margin:0;">${greeting(ctx.customerName)}</p>
    <p style="font-size:14px;line-height:1.5;margin:8px 0 0;">${opts.body}</p>
    ${cta}
    ${summary}
    ${contact}
    <p style="color:#999;font-size:12px;margin:24px 0 0;">You ordered from ${store} on Vendylio. This is a transactional message about order ${ref}.</p>
  </div>`;
}

function textShell(opts: {
  ctx: OrderEmailContext;
  heading: string;
  body: string;
  showSummary: boolean;
  showCta: boolean;
}): string {
  const { ctx } = opts;
  const parts = [
    `${ctx.storeName} — ${opts.heading}`,
    `Order ${ctx.orderReference}`,
    '',
    opts.body,
  ];
  if (opts.showCta) parts.push('', `Track your order: ${ctx.trackingUrl}`);
  if (opts.showSummary) parts.push('', itemsTextLines(ctx));
  parts.push('', `You ordered from ${ctx.storeName} on Vendylio.`);
  return parts.join('\n');
}

/** Sent from markPaid once payment is authoritative (§43/§100). */
export function orderConfirmationEmail(ctx: OrderEmailContext): OrderEmailTemplate {
  const body =
    ctx.fulfillmentMethod === 'PICKUP'
      ? "We've received your order and payment. The store will let you know when it's ready to collect."
      : "We've received your order and payment. The store will start preparing it shortly.";
  return {
    subject: `Your order from ${ctx.storeName} is confirmed — ${ctx.orderReference}`,
    html: shell({ ctx, heading: 'Order confirmed', body, showSummary: true, showCta: true }),
    text: textShell({ ctx, heading: 'Order confirmed', body, showSummary: true, showCta: true }),
  };
}

export type OrderStatusEmailKind =
  | 'PREPARING'
  | 'READY'
  | 'ON_THE_WAY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'DELIVERY_ISSUE';

const STATUS_EMAIL_COPY: Record<
  OrderStatusEmailKind,
  {
    heading: string;
    subject: (ref: string, store: string) => string;
    body: (m: FulfillmentLabel) => string;
  }
> = {
  PREPARING: {
    heading: 'Your order is being prepared',
    subject: (ref, store) => `Your order from ${store} is being prepared — ${ref}`,
    body: () => 'Good news — the store is preparing your order now.',
  },
  READY: {
    heading: 'Your order is ready',
    subject: (ref, store) => `Your order from ${store} is ready — ${ref}`,
    body: (m) =>
      m === 'PICKUP'
        ? 'Your order is ready for pickup — come by whenever works for you.'
        : 'Your order is ready and will be on its way shortly.',
  },
  ON_THE_WAY: {
    heading: 'Your order is on the way',
    subject: (ref, store) => `Your order from ${store} is on the way — ${ref}`,
    body: () => 'Your order is on the way. You can follow its progress from your tracking page.',
  },
  DELIVERED: {
    heading: 'Your order has been delivered',
    subject: (ref, store) => `Your order from ${store} has been delivered — ${ref}`,
    body: (m) =>
      m === 'PICKUP'
        ? 'Your order has been marked as collected. Enjoy!'
        : 'Your order has been delivered. Enjoy!',
  },
  CANCELLED: {
    heading: 'Your order has been cancelled',
    subject: (ref, store) => `Your order from ${store} has been cancelled — ${ref}`,
    body: () =>
      'Your order has been cancelled. If you were charged, the store will refund you according to its refund policy.',
  },
  DELIVERY_ISSUE: {
    heading: 'There’s a delay with your delivery',
    subject: (ref, store) => `Update on your order from ${store} — ${ref}`,
    body: () =>
      "We're having trouble completing your delivery. The store has been notified and is working on it — no action is needed from you right now.",
  },
};

type FulfillmentLabel = 'PICKUP' | 'DELIVERY';

/** Sent from the seller status routes / delivery webhook (§44–49). */
export function orderStatusUpdateEmail(
  ctx: OrderEmailContext,
  kind: OrderStatusEmailKind,
): OrderEmailTemplate {
  const copy = STATUS_EMAIL_COPY[kind];
  const body = copy.body(ctx.fulfillmentMethod);
  // Terminal-ish states don't need a summary re-print; in-progress ones do.
  const showSummary = kind === 'DELIVERED';
  return {
    subject: copy.subject(ctx.orderReference, ctx.storeName),
    html: shell({ ctx, heading: copy.heading, body, showSummary, showCta: true }),
    text: textShell({ ctx, heading: copy.heading, body, showSummary, showCta: true }),
  };
}

/** Sent from POST /api/orders/[id]/refund (§25). */
export function orderRefundedEmail(ctx: OrderEmailContext): OrderEmailTemplate {
  const body =
    'Your order has been refunded in full. The funds should appear back in your original payment method within 5–10 business days.';
  return {
    subject: `Your order from ${ctx.storeName} has been refunded — ${ctx.orderReference}`,
    html: shell({ ctx, heading: 'Order refunded', body, showSummary: true, showCta: false }),
    text: textShell({ ctx, heading: 'Order refunded', body, showSummary: true, showCta: false }),
  };
}
