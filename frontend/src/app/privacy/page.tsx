import { LegalPageLayout } from '@/components/legal/LegalPageLayout';

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="August 27, 2026">
      <p>
        This Privacy Policy explains what information Vendylio collects, how we use it, and the
        choices you have. It applies to Sellers, Buyers, and anyone else who uses Vendylio.
      </p>

      <h2>1. Information we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong> — email address, name, and password (stored as a
          secure hash, never in plain text) for Sellers and registered Buyers.
        </li>
        <li>
          <strong>Order information</strong> — for guest and registered checkouts: name, email,
          phone number, and delivery address, so a Seller (and courier, when delivery is used) can
          fulfill the order.
        </li>
        <li>
          <strong>Payment information</strong> — card payments are handled entirely by Stripe;
          Vendylio never receives or stores your full card number.
        </li>
        <li>
          <strong>Store information</strong> — for Sellers: store name, description, logo, and
          contact details displayed publicly on their storefront.
        </li>
        <li>
          <strong>Usage information</strong> — basic technical logs (IP address, browser type,
          timestamps) used for security, fraud prevention, and debugging.
        </li>
      </ul>

      <h2>2. How we use this information</h2>
      <ul>
        <li>To create and secure your account, and to authenticate you when you log in.</li>
        <li>To process orders, payments, and deliveries.</li>
        <li>To send transactional emails (order confirmations, verification codes, receipts).</li>
        <li>To detect and prevent fraud or abuse of the platform.</li>
        <li>To improve and maintain the Vendylio service.</li>
      </ul>

      <h2>3. Who we share it with</h2>
      <ul>
        <li>
          <strong>Stripe</strong> — for processing card payments and, for Sellers who opt in,
          payouts via Stripe Connect.
        </li>
        <li>
          <strong>Uber Direct</strong> — order pickup/delivery address and contact details, only for
          orders that use courier delivery.
        </li>
        <li>
          <strong>Resend</strong> — to deliver transactional emails.
        </li>
        <li>The Seller you order from — so they can fulfill and communicate about your order.</li>
      </ul>
      <p>We do not sell your personal information to third parties.</p>

      <h2>4. Data retention</h2>
      <p>
        We keep account and order data for as long as your account is active, and for a reasonable
        period afterward to comply with tax, accounting, and fraud-prevention obligations.
        Verification codes and short-lived security tokens are automatically deleted shortly after
        they expire.
      </p>

      <h2>5. Your choices</h2>
      <ul>
        <li>You can update your account information at any time from your dashboard.</li>
        <li>
          You can request deletion of your account by contacting us — some data (e.g. records needed
          for tax or dispute purposes) may be retained as required by law.
        </li>
      </ul>

      <h2>6. Cookies</h2>
      <p>
        Vendylio uses essential cookies to keep you signed in and to protect your account (session
        and CSRF-protection cookies). We do not use third-party advertising cookies.
      </p>

      <h2>7. Security</h2>
      <p>
        We use industry-standard measures (encrypted connections, hashed passwords, restricted
        internal access) to protect your data. No system is perfectly secure, and we cannot
        guarantee absolute security.
      </p>

      <h2>8. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will update the &quot;Last
        updated&quot; date above when we do.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about this policy or your data? Contact us at{' '}
        <a href="mailto:no-reply@vendylio.com">no-reply@vendylio.com</a>.
      </p>
    </LegalPageLayout>
  );
}
