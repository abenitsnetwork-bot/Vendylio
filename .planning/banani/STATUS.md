# Banani implementation status

Last updated: 2026-08-25

## Done
- [x] Landing Page — `src/app/page.tsx` — plan: `seller-flow-batch1.md`
- [x] Register Account — `src/app/register/page.tsx` — plan: `seller-flow-batch1.md`
- [x] Store Onboarding — `src/app/onboarding/page.tsx` — plan: `seller-flow-batch1.md`
- [x] Seller Dashboard — `src/app/dashboard/page.tsx` — plan: `seller-flow-batch1.md`
- [x] Add Product — `src/app/dashboard/products/new/page.tsx` — plan: `seller-flow-batch1.md`
- [x] Product Added Success — folded into `/dashboard/products/new` as a state, not a route — plan: `seller-flow-batch1.md`
- [x] Supporting pages (not in the Banani selection, required for the loop to work): `/login`, `/verify-email`

Verified end-to-end against the live dev server: signup → verify-email (real code from DB) →
create store → add product → dashboard stats reflect the real product count. `pnpm format &&
lint && typecheck && test` all green (591 tests). Visual/responsive check done by reading the
rendered HTML and Tailwind breakpoints, not a real browser screenshot — no headless browser is
available in this environment; open `http://localhost:3000` yourself to eyeball 375/768/1280px.

## Done — batch 2
- [x] How It Works — Detailed — `src/app/how-it-works/page.tsx`
  - 2026-09-01: its visual language (big number + rule, zigzag text/visual rows,
    card-framed mockups) applied as a **condensed, animated** landing section —
    `src/components/marketing/HowItWorksSection.tsx` (4 steps, desktop centre
    timeline + looping node pulse, scroll-reveal, CSS mini-mockups, no assets).
    Plan: `how-it-works-landing-section.md`.
- [x] Account Menu Dropdown — `src/components/seller/AccountMenu.tsx` (wired into `SellerHeader`, used on every `/dashboard/*` page)
- [x] Billing & Payouts — `src/app/dashboard/billing/page.tsx` — real withdrawal history + real request form (Cash App/Zelle, USD)
- [x] Guide: Your First 5 Products — `src/app/dashboard/resources/first-products/page.tsx`
- [x] Resources & Learning Center — `src/app/dashboard/resources/page.tsx` (trimmed to the 3 real guides — see note below)
- [x] Security Settings — folded into the existing `/settings` page (restyled), not duplicated
- [x] Share Store Modal — `src/components/seller/ShareStoreModal.tsx` (real link, real WhatsApp/email share intents)
- [x] Store Settings — `src/app/dashboard/settings/page.tsx` — real, backed by new `PATCH /api/stores`
- [x] Guide: Setting Up Delivery — `src/app/dashboard/resources/delivery/page.tsx`
- [x] Guide: Payment Setup — `src/app/dashboard/resources/payment-setup/page.tsx` (content rewritten to match the real Cash App/Zelle/manual-payout system, not Banani's bank-transfer copy)

Skipped: Vendylio — Landing Page (Next) [alt variant, identical source to primary Landing].

## Backend change in this batch
`POST /api/withdrawals` was adapted from the starter's West-African mobile-money
defaults (Wave/Orange Money/MTN, XOF, routed through Bictorys) to Vendylio's
real target — US sellers paid via Cash App/Zelle in USD. `provider` is now
`"manual"`: there's no payout API for Cash App/Zelle, so an operator fulfills
requests by hand via the existing `/api/admin/withdrawals` tooling. Tests
updated to match (`route.test.ts`, 20/20 green).

## Known limitation carried into batch 2
`Order` still isn't linked to `Store`/`Product` (see batch 1 plan). This means
the withdrawal balance check (`createDefaultBalanceComputer`) always sees $0
for a seller's real earnings — Billing & Payouts is honest about this (shows
$0.00 with a note) rather than faking a balance. A real withdrawal will
currently always 422 `INSUFFICIENT_BALANCE` until checkout is wired to Store.

## Content trimmed rather than faked (batch 2)
Banani's Resources & Learning Center also specified Marketing/Operations/Money
categories, a templates-download grid, fabricated "success stories", and an
email newsletter signup — none had any real content or backend behind them.
Shipped only the 3 real guides; extend the list as more guides get built.

## Done — batch 3 (not a Banani screen — designed to fill a real gap)
- [x] Public storefront `/s/[slug]` — `src/app/s/[slug]/page.tsx` — what a
  customer actually sees from a shared store link. Server Component reading
  Prisma directly via `src/lib/server/storefront.ts` (`getPublicStore`), not
  routed through `/api/*`, so the page is real SSR HTML for link-preview
  crawlers. Lists only `status: 'ACTIVE'` products; shows a real empty state
  when a store has none; 404s via `notFound()` for an unknown slug.
  `productCategories.ts` extracted as the single source of truth for category
  labels (was duplicated inline in `AddProductForm` and the products Zod enum).

## Done — batch 4 (photo/product CRUD, requested directly by the user)
Sellers can now fully manage their own product photos — upload, replace, or
remove — plus the products themselves:
- `GET /api/products/[id]`, `PATCH /api/products/[id]`, `DELETE /api/products/[id]`
  — ownership checked by `storeId`, 404 (not 403) on mismatch to avoid id probing
- `GET /api/products` — the seller's own product list (all statuses)
- `src/app/dashboard/products/page.tsx` — product catalog grid, links to edit
- `src/app/dashboard/products/[id]/edit/page.tsx` — edit or delete a product
- `ImageDropzone` upgraded to show a real photo preview + "Replace photo" /
  "Remove image" (×) once a value exists, reused by both product photos and
  the store logo (Store Settings can now also clear its logo, not just
  replace it)
- `AddProductForm` retired in favor of `ProductForm` (`mode: 'create' | 'edit'`)
  shared by both the add and edit flows
- Dashboard's "Active Products" stat card now links to `/dashboard/products`

Not built: actually purging the old file from Cloudinary when a photo is
replaced/removed — only the URL reference on the Product/Store row changes.
Orphaned Cloudinary assets are a storage-hygiene cleanup, separate from the
seller-facing capability that was asked for.

## Done — batch 5 (storefront templates + cart, requested directly by the user)
- [x] `Store.template` (`MODERN` | `MINIMAL` | `BOLD`, default `MODERN`) — schema
  + `PATCH /api/stores` + `getPublicStore`
- [x] `src/lib/storeTemplates.ts` — single source of truth for template values/labels
- [x] Store Settings — visual template picker (mini CSS mockups per option) +
  a "View your store →" live link
- [x] Three real layout components under `src/components/storefront/templates/`
  (Modern = grid, Minimal = single-column list, Bold = large imagery/editorial),
  all driven by the same `PublicStore` data
- [x] Client-side shopping cart (`CartContext`, localStorage-keyed per store
  slug — no customer account needed) — add/remove/adjust quantity, capped at
  each product's real stock
- [x] Cart drawer + floating cart button with item-count badge, wired into
  every template via `StorefrontShell`
- [x] `/s/[slug]` page simplified to a thin Server Component (metadata + data
  fetch) handing off to the client `StorefrontShell`

**Checkout is intentionally NOT built yet** — the cart's "Checkout" button is
visibly present but disabled ("coming soon"). The user chose Stripe for real
payment processing; that's the next pass (Order↔Store/Product linkage +
Stripe integration, referencing the `izisaas-payments-handler` skill), kept
separate from this templates+cart pass by explicit user choice.

Not covered by automated tests: the cart is pure client-side React state
(`CartContext`) and this project's Vitest setup runs in a Node environment
with no jsdom/localStorage and no precedent for component tests — verified
instead by checking each template renders distinctly server-side (curl +
grep for template-specific markup) after flipping `Store.template` through
all three values live.

## Open design questions
- None blocking. See "Design-source issues found" in `seller-flow-batch1.md` (batch 1) and the notes above (batches 2–5) for deviations from literal Banani output.
