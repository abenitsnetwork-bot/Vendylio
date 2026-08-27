import { LegalPageLayout } from '@/components/legal/LegalPageLayout';

export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated="August 27, 2026">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of Vendylio
        (&quot;Vendylio,&quot; &quot;we,&quot; &quot;us&quot;), a platform operated from Maryland,
        USA that lets individuals and businesses (&quot;Sellers&quot;) create online stores and sell
        products to their customers (&quot;Buyers&quot;). By creating an account, opening a store,
        or placing an order through Vendylio, you agree to these Terms.
      </p>

      <h2>1. What Vendylio is</h2>
      <p>
        Vendylio is a technology platform. We provide the software Sellers use to list products,
        accept payments, and arrange delivery or pickup. Vendylio is not the seller of record for
        any product listed on the platform — each Seller is solely responsible for their own store,
        product listings, pricing, descriptions, inventory, and fulfillment.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You must provide accurate information when creating an account and keep your login
        credentials confidential. You are responsible for all activity that happens under your
        account. We may suspend or terminate an account that violates these Terms, engages in fraud,
        or poses a risk to other users of the platform.
      </p>

      <h2>3. Sellers</h2>
      <ul>
        <li>
          Sellers are independent operators of their own stores, not employees or agents of
          Vendylio.
        </li>
        <li>
          Sellers are responsible for the accuracy of their listings, the quality and legality of
          what they sell, and complying with applicable tax, consumer-protection, and product-safety
          laws in their jurisdiction.
        </li>
        <li>
          Vendylio may charge a platform fee (commission) on orders processed through a store,
          disclosed to the Seller in their dashboard. This fee is deducted before funds are settled
          to the Seller.
        </li>
      </ul>

      <h2>4. Buyers</h2>
      <p>
        When you place an order, you are contracting directly with the Seller, not with Vendylio.
        Vendylio processes the payment and, where applicable, coordinates delivery, but Vendylio is
        not responsible for the condition, description accuracy, or timely delivery of a product
        beyond the platform&apos;s own processing and delivery-coordination role.
      </p>

      <h2>5. Payments</h2>
      <p>
        Card payments are processed by Stripe. Vendylio does not store your full card details. Some
        Sellers may also offer manual payment methods (e.g. Cash App, Zelle) at their own discretion
        — Vendylio has no visibility into or control over funds sent this way, and cannot reverse or
        guarantee those transactions.
      </p>

      <h2>6. Delivery and pickup</h2>
      <p>
        Depending on the store, an order is either picked up directly from the Seller or delivered
        by a third-party courier (currently Uber Direct). Delivery times and fees are estimates
        provided by the courier and are not guaranteed by Vendylio.
      </p>

      <h2>7. Refunds and cancellations</h2>
      <p>
        Each Seller sets and is responsible for their own refund and cancellation policy. See our{' '}
        <a href="/refund-policy">Refund Policy</a> page for how this works and how to raise a
        dispute if a Seller is unresponsive.
      </p>

      <h2>8. Prohibited use</h2>
      <p>
        You may not use Vendylio to sell illegal goods or services, infringe on intellectual
        property, commit fraud, or otherwise misuse the platform. We may remove listings or suspend
        accounts that violate this section without notice.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        Vendylio is provided &quot;as is.&quot; To the fullest extent permitted by law, Vendylio is
        not liable for indirect, incidental, or consequential damages arising from your use of the
        platform, including disputes between Buyers and Sellers.
      </p>

      <h2>10. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Continued use of Vendylio after an update means
        you accept the revised Terms.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about these Terms? Contact us at{' '}
        <a href="mailto:no-reply@vendylio.com">no-reply@vendylio.com</a>.
      </p>
    </LegalPageLayout>
  );
}
