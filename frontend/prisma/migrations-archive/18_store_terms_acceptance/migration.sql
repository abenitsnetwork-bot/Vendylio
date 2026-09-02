-- Terms of Service acceptance at store creation.
-- POST /api/stores stamps termsAcceptedAt + termsVersion; the onboarding
-- business step gates "Create store" behind a checkbox + a Terms modal.
-- Pre-existing stores stay NULL (they predate the gate).
ALTER TABLE "Store"
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "termsVersion" TEXT;
