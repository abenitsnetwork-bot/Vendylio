import type { Metadata } from 'next';
import { Inter, Fraunces } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/contexts/ToastContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { SentryClientInit } from '@/components/SentryClientInit';
import { siteOrigin } from '@/lib/seo';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Bold soft-serif for headings — the "Find Your Signature Seat" style
// display type from the reference theme. Inter stays the body font.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  weight: ['600', '700'],
  display: 'swap',
});

// CSP phase 2 (enforcing, nonce-based — see src/proxy.ts + docs/security/csp.md).
// A per-request nonce can only be injected into a page that is rendered per
// request. Setting `dynamic` on the root layout opts the whole app out of
// static prerendering so every page's <script> tags receive the nonce; without
// it, prerendered pages (login, pricing, dashboard shells, …) would ship
// nonce-less scripts that the enforcing `script-src` blocks. These pages are
// all lightweight (auth-gated or low-traffic marketing) and the high-traffic
// storefront routes were already dynamic, so the cost is marginal.
export const dynamic = 'force-dynamic';

// metadataBase lets every page's relative `alternates.canonical` and
// `openGraph` URLs resolve to absolute ones (storefront pages rely on this).
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  // No `title.template` — storefront pages set a merchant-first title
  // (just the store/product name, no "| Vendylio" suffix) so each store
  // reads as its own independent business.
  title: 'Vendylio — open your online store',
  description: 'Open your online store and start selling — free, in minutes.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className={inter.className}>
        <SentryClientInit />
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
