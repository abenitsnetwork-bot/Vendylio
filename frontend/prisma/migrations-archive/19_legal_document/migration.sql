-- Editable legal pages (Terms of Service, Privacy Policy, Refund Policy).
-- SUPERADMIN edits these from Settings → Legal pages; the public /terms,
-- /privacy, /refund-policy routes + the onboarding Terms modal read the
-- live text. No seed row — an absent slug falls back to the bundled
-- default in lib/legal/defaults.ts, so existing installs are unaffected.
CREATE TABLE "LegalDocument" (
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("slug")
);
