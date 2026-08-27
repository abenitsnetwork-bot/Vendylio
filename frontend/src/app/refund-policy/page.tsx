import { LegalPageLayout } from '@/components/legal/LegalPageLayout';

export default function RefundPolicyPage() {
  return (
    <LegalPageLayout title="Refund Policy" lastUpdated="August 27, 2026">
      <p>
        Vendylio is a platform that connects independent Sellers with Buyers. Each Seller sets and
        is responsible for their own refund, return, and cancellation policy — Vendylio does not set
        a single platform-wide refund rule, the same way a marketplace like Etsy or Shopify does not
        refund purchases on a merchant&apos;s behalf.
      </p>

      <h2>1. Requesting a refund from a Seller</h2>
      <p>
        If you&apos;re not satisfied with an order, contact the Seller directly first — their
        contact details are on their storefront and in your order confirmation email. Most issues
        (wrong item, damaged product, order never arrived) are resolved directly between Buyer and
        Seller.
      </p>

      <h2>2. Orders paid by card (Stripe)</h2>
      <p>
        For orders paid by card, a Seller can issue a refund back to your original payment method
        through their dashboard. Refunds typically appear on your statement within 5–10 business
        days, depending on your bank.
      </p>

      <h2>3. Orders paid by manual methods (Cash App, Zelle)</h2>
      <p>
        For orders paid through a manual payment method, Vendylio has no visibility into or control
        over the transfer of funds and cannot process or guarantee a refund. Any refund must be
        arranged directly with the Seller through the same payment method.
      </p>

      <h2>4. Cancelling an order before it ships</h2>
      <p>
        An order can usually be cancelled while it&apos;s still <em>Pending</em> or{' '}
        <em>Preparing</em>. Once a Seller marks an order <em>Ready</em> or it has been handed to a
        courier for delivery, cancellation is at the Seller&apos;s discretion.
      </p>

      <h2>5. Delivery issues</h2>
      <p>
        For orders delivered by a courier (Uber Direct), delivery-specific problems (late delivery,
        lost package) should also be reported to the Seller first, who can investigate with the
        courier on your behalf.
      </p>

      <h2>6. If a Seller is unresponsive</h2>
      <p>
        If you&apos;ve contacted a Seller and haven&apos;t received a response within a reasonable
        time, you can reach Vendylio at{' '}
        <a href="mailto:no-reply@vendylio.com">no-reply@vendylio.com</a>. We can&apos;t force a
        refund on a Seller&apos;s behalf, but we can help mediate and, for repeated unresolved
        complaints, take action on the Seller&apos;s account.
      </p>
    </LegalPageLayout>
  );
}
