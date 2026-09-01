// Bundled default text for the editable legal pages. This is a plain
// module (no React) so server routes and Prisma-facing helpers can import
// it freely — the rendering lives in components/legal/LegalMarkdown.tsx.
//
// `body` is Markdown in the small subset understood by
// lib/legal/parseLegalMarkdown.ts: `## ` headings, blank-line-separated
// paragraphs, `- ` bullet lists, `[label](href)` links, `**bold**`,
// `*italic*`. Keep the wording of these defaults verbatim with the text a
// lawyer signed off on — a SUPERADMIN overrides them from Settings → Legal
// pages, and until they do these strings are what the public pages serve.
//
// When a row exists in the LegalDocument table for a slug it wins entirely;
// this file is only the fallback. Bump the `version` of a default whenever
// its `body` changes materially (the value is snapshotted onto every new
// store as `Store.termsVersion`).

export const LEGAL_SLUGS = ['terms', 'privacy', 'refund-policy'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}

export interface LegalDefault {
  title: string;
  version: string;
  /** Human date shown as "Last updated: …" when no edited row exists. */
  lastUpdated: string;
  /** Markdown source (see parseLegalMarkdown.ts for the supported subset). */
  body: string;
}

const TERMS_BODY = `These Terms of Service ("Terms") govern your access to and use of Vendylio ("Vendylio," "we," "us"), a platform operated from Maryland, USA that lets individuals and businesses ("Sellers") create online stores and sell products to their customers ("Buyers"). By creating an account, opening a store, or placing an order through Vendylio, you agree to these Terms.

## 1. What Vendylio is

Vendylio is a technology platform. We provide the software Sellers use to list products, accept payments, and arrange delivery or pickup. Vendylio is not the seller of record for any product listed on the platform — each Seller is solely responsible for their own store, product listings, pricing, descriptions, inventory, and fulfillment.

## 2. Accounts

You must provide accurate information when creating an account and keep your login credentials confidential. You are responsible for all activity that happens under your account. We may suspend or terminate an account that violates these Terms, engages in fraud, or poses a risk to other users of the platform.

## 3. Sellers

- Sellers are independent operators of their own stores, not employees or agents of Vendylio.
- Sellers are responsible for the accuracy of their listings, the quality and legality of what they sell, and complying with applicable tax, consumer-protection, and product-safety laws in their jurisdiction.
- Vendylio may charge a platform fee (commission) on orders processed through a store, disclosed to the Seller in their dashboard. This fee is deducted before funds are settled to the Seller.

## 4. Buyers

When you place an order, you are contracting directly with the Seller, not with Vendylio. Vendylio processes the payment and, where applicable, coordinates delivery, but Vendylio is not responsible for the condition, description accuracy, or timely delivery of a product beyond the platform's own processing and delivery-coordination role.

## 5. Payments

Card payments are processed by Stripe. Vendylio does not store your full card details. Some Sellers may also offer manual payment methods (e.g. Cash App, Zelle) at their own discretion — Vendylio has no visibility into or control over funds sent this way, and cannot reverse or guarantee those transactions.

## 6. Delivery and pickup

Depending on the store, an order is either picked up directly from the Seller or delivered by a third-party courier (currently Uber Direct). Delivery times and fees are estimates provided by the courier and are not guaranteed by Vendylio.

## 7. Refunds and cancellations

Each Seller sets and is responsible for their own refund and cancellation policy. See our [Refund Policy](/refund-policy) page for how this works and how to raise a dispute if a Seller is unresponsive.

## 8. Prohibited use

You may not use Vendylio to sell illegal goods or services, infringe on intellectual property, commit fraud, or otherwise misuse the platform. We may remove listings or suspend accounts that violate this section without notice.

## 9. Limitation of liability

Vendylio is provided "as is." To the fullest extent permitted by law, Vendylio is not liable for indirect, incidental, or consequential damages arising from your use of the platform, including disputes between Buyers and Sellers.

## 10. Changes to these Terms

We may update these Terms from time to time. Continued use of Vendylio after an update means you accept the revised Terms.

## 11. Contact

Questions about these Terms? Contact us at [no-reply@vendylio.com](mailto:no-reply@vendylio.com).`;

const PRIVACY_BODY = `This Privacy Policy explains what information Vendylio collects, how we use it, and the choices you have. It applies to Sellers, Buyers, and anyone else who uses Vendylio.

## 1. Information we collect

- **Account information** — email address, name, and password (stored as a secure hash, never in plain text) for Sellers and registered Buyers.
- **Order information** — for guest and registered checkouts: name, email, phone number, and delivery address, so a Seller (and courier, when delivery is used) can fulfill the order.
- **Payment information** — card payments are handled entirely by Stripe; Vendylio never receives or stores your full card number.
- **Store information** — for Sellers: store name, description, logo, and contact details displayed publicly on their storefront.
- **Usage information** — basic technical logs (IP address, browser type, timestamps) used for security, fraud prevention, and debugging.

## 2. How we use this information

- To create and secure your account, and to authenticate you when you log in.
- To process orders, payments, and deliveries.
- To send transactional emails (order confirmations, verification codes, receipts).
- To detect and prevent fraud or abuse of the platform.
- To improve and maintain the Vendylio service.

## 3. Who we share it with

- **Stripe** — for processing card payments and, for Sellers who opt in, payouts via Stripe Connect.
- **Uber Direct** — order pickup/delivery address and contact details, only for orders that use courier delivery.
- **Resend** — to deliver transactional emails.
- The Seller you order from — so they can fulfill and communicate about your order.

We do not sell your personal information to third parties.

## 4. Data retention

We keep account and order data for as long as your account is active, and for a reasonable period afterward to comply with tax, accounting, and fraud-prevention obligations. Verification codes and short-lived security tokens are automatically deleted shortly after they expire.

## 5. Your choices

- You can update your account information at any time from your dashboard.
- You can request deletion of your account by contacting us — some data (e.g. records needed for tax or dispute purposes) may be retained as required by law.

## 6. Cookies

Vendylio uses essential cookies to keep you signed in and to protect your account (session and CSRF-protection cookies). We do not use third-party advertising cookies.

## 7. Security

We use industry-standard measures (encrypted connections, hashed passwords, restricted internal access) to protect your data. No system is perfectly secure, and we cannot guarantee absolute security.

## 8. Changes to this policy

We may update this Privacy Policy from time to time. We will update the "Last updated" date above when we do.

## 9. Contact

Questions about this policy or your data? Contact us at [no-reply@vendylio.com](mailto:no-reply@vendylio.com).`;

const REFUND_BODY = `Vendylio is a platform that connects independent Sellers with Buyers. Each Seller sets and is responsible for their own refund, return, and cancellation policy — Vendylio does not set a single platform-wide refund rule, the same way a marketplace like Etsy or Shopify does not refund purchases on a merchant's behalf.

## 1. Requesting a refund from a Seller

If you're not satisfied with an order, contact the Seller directly first — their contact details are on their storefront and in your order confirmation email. Most issues (wrong item, damaged product, order never arrived) are resolved directly between Buyer and Seller.

## 2. Orders paid by card (Stripe)

For orders paid by card, a Seller can issue a refund back to your original payment method through their dashboard. Refunds typically appear on your statement within 5–10 business days, depending on your bank.

## 3. Orders paid by manual methods (Cash App, Zelle)

For orders paid through a manual payment method, Vendylio has no visibility into or control over the transfer of funds and cannot process or guarantee a refund. Any refund must be arranged directly with the Seller through the same payment method.

## 4. Cancelling an order before it ships

An order can usually be cancelled while it's still *Pending* or *Preparing*. Once a Seller marks an order *Ready* or it has been handed to a courier for delivery, cancellation is at the Seller's discretion.

## 5. Delivery issues

For orders delivered by a courier (Uber Direct), delivery-specific problems (late delivery, lost package) should also be reported to the Seller first, who can investigate with the courier on your behalf.

## 6. If a Seller is unresponsive

If you've contacted a Seller and haven't received a response within a reasonable time, you can reach Vendylio at [no-reply@vendylio.com](mailto:no-reply@vendylio.com). We can't force a refund on a Seller's behalf, but we can help mediate and, for repeated unresolved complaints, take action on the Seller's account.`;

export const LEGAL_DEFAULTS: Record<LegalSlug, LegalDefault> = {
  terms: {
    title: 'Terms of Service',
    version: '2026-08-27',
    lastUpdated: 'August 27, 2026',
    body: TERMS_BODY,
  },
  privacy: {
    title: 'Privacy Policy',
    version: '2026-08-27',
    lastUpdated: 'August 27, 2026',
    body: PRIVACY_BODY,
  },
  'refund-policy': {
    title: 'Refund Policy',
    version: '2026-08-27',
    lastUpdated: 'August 27, 2026',
    body: REFUND_BODY,
  },
};

// Back-compat: the Terms version is snapshotted onto new stores. Prefer
// reading the live value via getLegalDocument('terms') (lib/server/legal.ts)
// in server code — this constant is only the compile-time default.
export const TERMS_VERSION = LEGAL_DEFAULTS.terms.version;
export const TERMS_LAST_UPDATED = LEGAL_DEFAULTS.terms.lastUpdated;
