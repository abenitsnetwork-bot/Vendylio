# Vendylio — Flow vendeur principal (batch 1) — Banani → Next.js 16

## Source
- Banani flow: "Marché Express" (`nhoiEyXNmOFZ`)
- Fetched: 2026-08-25
- Screens in this batch: Vendylio — Landing Page, Register Account, Store Onboarding, Seller Dashboard, Add Product, Product Added Success
- Deferred to a later batch: How It Works (Detailed), Account Menu Dropdown, Billing & Payouts, Guide: Your First 5 Products, Resources & Learning Center, Security Settings, Share Store Modal, Store Settings, Guide: Setting Up Delivery, Guide: Payment Setup, Landing Page (Next) variant

## System understanding (Step 0 answers)
1. Route tree: `/` (landing, replaces the stub `return null`), `/register`, `/onboarding`, `/dashboard`, `/dashboard/products/new`. `/login` and `/verify-email` are new supporting pages (adapted from `examples/frontend-pages/`, not in the Banani selection) — required for the register → verify → sign-in loop to actually work end to end.
2. Public vs gated: `/`, `/register`, `/login` are public. `/onboarding`, `/dashboard`, `/dashboard/products/new` require an authenticated + verified user (added to `AUTH_PROTECTED_PREFIXES`).
3. Data read: `GET /api/stores/me` (store + product count). No Order↔Store link exists yet, so dashboard sales/orders/visits stay at 0 — which matches Banani's own new-seller empty state, not a shortcut.
4. Data write: `/api/auth/signup` (existing, untouched) for registration; new `POST /api/stores` for onboarding; new `POST /api/products` for the add-product form. Logo/product photo use the existing `/api/upload` (Cloudinary) route, called client-side, URL passed into the create payload.
5. Nav flow: Landing CTA → `/register` → `/verify-email` (existing verify endpoint, new page) → `/onboarding` → `/dashboard` → `/dashboard/products/new` → success state → back to dashboard or add another.
6. Reuse: new primitives `Icon` (lucide-react), `Button`, `Field`, `Card` under `src/components/ui/`; marketing blocks under `src/components/marketing/`; seller blocks under `src/components/seller/`.
7. Empty/loading/error: dashboard shows a loading skeleton and an error state if `/api/stores/me` fails; forms show inline field + submit errors.
8. Side effects: none beyond the existing signup verification email (outbox, untouched).

## Design-source issues found (flagging, not silently reproducing)
- Banani's `NavBar.jsx` component is actually an "Admin Sidebar" (full-height `<aside>`), but the Landing and Register screens import it as a top nav. Reproducing it literally would put a dashboard sidebar on the marketing site. **Decision: build a proper horizontal `PublicNavBar`** (logo, links, Log in / Open Store Now) for `/`, `/register`; the sidebar shape is simply unused (Seller Dashboard/Add Product/Onboarding all define their own horizontal header inline in the Banani source anyway, so nothing depended on the sidebar being real).
- `@global/Image` / `@global/UserAvatar` are Banani's placeholder-art generator (AI image prompts) — not real assets. Reproducing them as fetched external image URLs would mean guessing URLs, which is unsafe. **Decision: render styled gradient/icon placeholder blocks** at the same aspect ratios instead, swappable later for real product photos.
- `StoreSetupForm` only has real fields for "step 1" (Store Basics); steps 2/3 ("Products", "Delivery") are decorative progress-bar labels with no field content anywhere in the fetched source. **Decision: ship step 1 as the actual onboarding form** (creates the Store, then routes to `/dashboard`); do not fabricate steps 2/3 content that Banani never specified.
- `Product Added Success` is modeled as its own screen in Banani, but it has no data of its own — it's a pure post-submit confirmation. **Decision: render it as a state swap inside `/dashboard/products/new`** rather than a separate route+fetch, avoiding a throwaway navigation.

## Token mapping (Banani `@theme` → Tailwind v4 `@theme` extension)
Added verbatim into `globals.css` under `@theme` (Tailwind v4 zero-config already in place):
| Banani token | Value |
|---|---|
| `--color-primary` | `#67bed9` |
| `--color-background` | `#f4f4f4` |
| `--color-foreground` | `#111111` |
| `--color-border` | `#e0e0e0` |
| `--color-input` | `#f8f8f8` |
| `--color-secondary` | `#f9f9f9` |
| `--color-muted` | `#e8e8e8` / `--color-muted-foreground` `#888888` |
| `--color-card` | `#ffffff` |
| `--radius-sm/md/lg/xl` | `6/10/16/24px` |
| `--font-body` / `--font-headings` | Inter (already the project's font) |

## Responsive plan (Banani is desktop-only; mobile is ours to design)
- **Base (375px)**: single column everywhere. Landing hero stacks (image below copy, floating chips become static cards, not absolutely positioned). Nav collapses to logo + hamburger sheet. Register's 2-column (form / benefits) stacks — form first, benefits panel below, collapsed to a 2-col icon grid. Dashboard stat cards go 2×2. Seller header keeps logo + a single icon action (bell/close), profile menu becomes a bottom sheet trigger. Forms: full-width fields, ≥48px tap targets, category picker wraps to 2 columns.
- **md (768px+)**: dashboard stats 4-in-a-row starts here if it fits comfortably, else stays 2×2 until lg. Register goes 2-column.
- **lg (1024px+)**: matches the Banani desktop mockup as fetched (`px-14` header/section padding, 4-col steps, 3-col feature/testimonial grids).
- **xl (1280px+)**: page content gets a `max-w-7xl` wrapper so `px-14` doesn't stretch edge-to-edge on ultra-wide screens (Banani has no max-width; we add one, it's a responsive improvement not a deviation).

## Data model additions (Prisma)
```
model Store {
  id, userId (unique, 1 store per seller), slug (unique), name, description?,
  city?, state?, logoUrl?, createdAt, updatedAt
  products Product[]
}
model Product {
  id, storeId, name, description?, priceCents Int, quantity Int, category String,
  imageUrl?, status ("ACTIVE"|"ARCHIVED", default ACTIVE), createdAt, updatedAt
}
```
`User.store Store?` relation added. `category` is a closed string enum validated in Zod: `FOOD_SPICES | BEAUTY_PERSONAL_CARE | TEXTILES_CRAFTS | OTHER` (matches the 4 chips in `AddProductForm`).

## New routes
- `POST /api/stores` — `requireAuth` + `verifyCsrf`; 409 `STORE_ALREADY_EXISTS` if the user already has one; slugifies the name via the existing `slugify`/`ensureUniqueSlug` helpers.
- `GET /api/stores/me` — `requireAuth`; 404 `NO_STORE` if none; else `{ store, stats: { productCount, salesCents: 0, ordersCount: 0, visits: 0 } }`.
- `POST /api/products` — `requireAuth` + `verifyCsrf`; 404 `NO_STORE` if the seller has no store yet.
All get `route.test.ts` siblings (happy path, auth 401, validation 400) to match the project's 100%-routes-tested convention, and `export const runtime = 'nodejs'` per the CI tripwire.

## Implementation checklist
- [ ] Prisma schema: `Store`, `Product`, `User.store` relation → `pnpm db:push`
- [ ] `lucide-react` dependency + `src/components/ui/Icon.tsx` name→component map (only the ~20 icons actually used)
- [ ] `src/components/ui/{Button,Field,Card}.tsx`
- [ ] `src/components/marketing/{PublicNavBar,HeroSection,HowItWorksSection,FeaturesSection,TestimonialSection,CtaFooter}.tsx`
- [ ] `src/components/seller/{SellerHeader,StoreSetupForm,AddProductForm,ProductAddedSuccess}.tsx`
- [ ] Routes: `api/stores/route.ts`, `api/stores/me/route.ts`, `api/products/route.ts` (+ tests)
- [ ] Pages: `/` , `/register`, `/login`, `/verify-email`, `/onboarding`, `/dashboard`, `/dashboard/products/new`
- [ ] `AUTH_PROTECTED_PREFIXES` includes `/dashboard,/onboarding` in `.env.example`
- [ ] `layout.tsx` metadata → Vendylio branding
- [ ] 375 / 768 / 1280px check in dev server
- [ ] `pnpm format && pnpm lint && pnpm typecheck && pnpm test`

## Open questions for user
- None blocking — all resolved via the earlier scoping question (recommended options chosen). Flagged design deviations above are implemented as stated; revisit if the user wants literal 1:1 (including the broken sidebar / fake steps) instead.
