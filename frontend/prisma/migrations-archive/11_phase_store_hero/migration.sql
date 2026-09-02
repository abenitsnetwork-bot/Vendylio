-- Phase 9 — storefront hero carousel.
--
-- All additive with safe defaults: every existing store keeps working
-- unchanged. `heroImages` defaults to [] (no hero → storefront renders
-- exactly as before); `heroHeadline` / `heroSubhead` are a single global
-- promo message overlaid on the slides. `heroImages` is JSONB: an ordered
-- array of up to 3 image URLs (["https://...", ...]).

ALTER TABLE "Store" ADD COLUMN "heroImages" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Store" ADD COLUMN "heroHeadline" TEXT;
ALTER TABLE "Store" ADD COLUMN "heroSubhead" TEXT;
