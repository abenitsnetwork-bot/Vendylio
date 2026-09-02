-- Phase 9b — storefront promo polish.
--
-- All additive, all nullable, no defaults needed:
--   Store.announcement — a thin always-visible promo strip at the top of the
--     storefront ("Free delivery over $30"). Distinct from the hero and from
--     pauseMessage.
--   Category.icon — an optional emoji shown before the name in the storefront
--     category nav + section headings.

ALTER TABLE "Store" ADD COLUMN "announcement" TEXT;
ALTER TABLE "Category" ADD COLUMN "icon" TEXT;
