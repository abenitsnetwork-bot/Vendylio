# How It Works (landing section) — Banani "How It Works — Detailed" → Next 16 / Tailwind v4

## Source

- Banani flow: Marché Express (`nhoiEyXNmOFZ`)
- Screen: `How It Works — Detailed` (`nhoiEyXNmOFZ/screens/HowItWorksDetail.jsx`), `screenSize: desktop`
- Fetched: 2026-09-01
- Note: the full `/how-it-works` PAGE was already built 1:1 from this screen
  (`.planning/banani/STATUS.md`). This task takes the screen's *visual language*
  (big number + rule, zigzag text/visual rows, card-framed mockups) and applies
  a **condensed, animated** version to the compact landing section
  `src/components/marketing/HowItWorksSection.tsx`.

## Decisions (user)

- Target = the compact landing section, not `/how-it-works`.
- "Surprends-moi" — senior judgment to bring it closer to the Banani layout and
  make it lively.

## Direction

Condensed 4-step **vertical-timeline zigzag** (desktop) / **elegant stack** (mobile).

- Keep content: Create store / Share link / Get paid / A courier delivers.
- Keep section header + "See the full walkthrough →" link to `/how-it-works`.
- Banani number treatment: `clamp(40px,7vw,52px)`, `text-accent` (coral — our
  "vive" answer to Banani's blue `--primary`), Fraunces, `-2px` tracking, with a
  short rule that scales in beside it.
- Each step → a **CSS mini-mockup** in a card frame
  (`bg-card rounded-xl border border-border shadow-sm aspect-[16/10]`), div-built,
  on-brand — no assets:
  1. mini storefront (header bar + 2 product tiles + price)
  2. browser URL bar `vendylio.com/s/your-store` + share glyphs
  3. payment-received card (green check · "$36.00 · Paid")
  4. delivery status (truck + progress dots + "Out for delivery")
- **Desktop (`lg`)**: centre vertical timeline (`bg-panel`), draws in (scaleY) on
  scroll; per-step node dot that pulses in sequence on a loop
  (`@keyframes hiw-node`, coral glow) — a "signal" rolling 01→04. Rows alternate
  text/visual sides.
- **Mobile**: single-column stack, no rail; big-number + card + mockup, revealed
  on scroll.
- **Reveal**: IntersectionObserver → per-row fade + slide from its side,
  staggered. `prefers-reduced-motion` → instant, node dots static.
- Replace the old horizontal `hiw-orb` (was for the 4-across row) + its keyframe.

## Token mapping (Banani → project)

| Banani | project |
|---|---|
| `--color-primary: #67bed9` (number, rule) | `text-accent` / `bg-panel` (kept on our sage/coral theme) |
| number `56px` / `-2px` | `clamp(40px,7vw,52px)` / `-2px` |
| title `28px` / `-0.8px` | `clamp(18px,3vw,22px)` / `-0.6px` |
| `grid grid-cols-2 gap-12`, zigzag `order` | `grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14` + `lg:order-*` |
| `<Image prompt=...>` AI mockups | CSS mini-mockups (no assets) |
| `bg-card rounded-lg border shadow-sm` frame | same, `rounded-xl` |

## Responsive plan

- **375 base**: 1 col. Number+rule, title, desc, then mockup card full-width.
  Steps `space-y-12`. No timeline rail.
- **lg (1024+)**: 2-col zigzag, centre timeline + node dots + pulse, `space-y-16`,
  rows alternate sides.

## Files

- **REWRITE** `src/components/marketing/HowItWorksSection.tsx` (client, already is)
- **EDIT** `src/app/globals.css` — swap `@keyframes hiw-orb` → `@keyframes hiw-node`
- No new deps. No API. Public section on `/`.

## Verification

- `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
- dev server: 375 / 768 / 1280 — no horizontal scroll, zigzag only on lg,
  timeline draws + node pulse loops, reduced-motion clean.
