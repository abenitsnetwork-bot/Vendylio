# Vendylio

**SaaS de boutiques en ligne pour petits commerçants.** Un commerçant crée sa boutique, publie ses produits, reçoit des commandes et des paiements en ligne, et livre via **retrait en boutique, livraison par le commerçant, DoorDash Drive ou Uber Direct**. Multi-tenant.

Une seule app Next.js 16 (App Router) déployable — aucun backend séparé. La logique serveur vit sous `frontend/src/app/api/*` et `frontend/src/lib/server/*`. Les providers tiers (Stripe, Cloudinary, Resend, DoorDash, Uber, Google OAuth, Sentry, Upstash) sont gated par variables d'environnement et inertes sans leurs clés ; l'app boote et `/api/auth` fonctionne avec juste `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` et `CRON_SECRET`.

Origine : bootstrappé depuis le starter `izi kit` (Next.js 16 headless) puis développé en phases successives (auth → OAuth/notifs → admin → uploads/withdrawals → webhooks/cron → catalogue & inventaire → checkout invité & storefront → moteur de livraison → onboarding commerçant → back-office admin → durcissement pilote). Voir [STATUS.md](STATUS.md) pour l'historique et [CLAUDE.md](CLAUDE.md) pour l'architecture détaillée (la source de vérité).

## Quickstart

Le projet est **cloud-only par design** — aucun conteneur local, aucun daemon. **[Neon](https://neon.tech) est le provider Postgres par défaut** : le code est tuné pour son comportement serverless (le handler de webhooks sort ses side-effects vers l'outbox pour éviter le plafond de tx 2s ; la mitigation timing-attack de `/forgot-password` calibre son floor sur la latence Neon-pooler ; un tripwire CI verrouille `.env.example` au format Neon). D'autres Postgres fonctionnent (SQL standard) mais demandent du tuning user-side.

```bash
git clone <fork-url> vendylio
cd vendylio
cp .env.example frontend/.env.local              # remplis DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, CRON_SECRET au minimum
pnpm install
pnpm db:migrate:deploy                           # applique les migrations versionnées sur ta DB Neon
pnpm dev                                         # http://localhost:3000
# dans un autre terminal, après le premier signup :
pnpm db:make-superadmin you@example.com
pnpm smoke:auth                                  # vérifie le happy path auth de bout en bout
```

Pour obtenir `DATABASE_URL` + `DIRECT_URL` : crée un projet gratuit sur https://neon.tech, puis copie deux strings depuis le dashboard — la version avec **`-pooler`** dans le hostname comme `DATABASE_URL` (avec `?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`) et la version sans `-pooler` comme `DIRECT_URL`. Exemples dans `.env.example`.

## Stack

- **App :** Next.js 16 (App Router) + React 19 + TypeScript strict — full-stack via `frontend/src/app/api/<resource>/route.ts` + Server Actions
- **Base de données :** Prisma 5 (Postgres / Neon serverless via URL `-pooler` + `DIRECT_URL` pour les migrations)
- **Paiements :** **Stripe + Stripe Connect** (destination charges + application fee ; fallback compte plateforme quand le commerçant n'a pas fini l'onboarding Connect) ; **Cash App / Zelle** en méthodes manuelles (le commerçant encaisse et confirme lui-même, aucune commission plateforme)
- **Livraison :** moteur provider-agnostic — `PICKUP`, `MERCHANT` (auto-livraison), `DOORDASH` (Drive), `UBER_DIRECT`, derrière l'interface `FulfillmentProvider` ; machine à états normalisée, webhooks courier + poll cron
- **Infra (optionnelles, env-gated) :** Upstash Redis (rate-limit + leader election + outbox), Cloudinary (média / uploads), Resend (email transactionnel via outbox), Google OAuth via `arctic`
- **Auth :** cookie + CSRF double-submit + JWT (access 15min / refresh 7j scope `/api/auth` / csrf 7j) ; signup enumeration-resistant, cookies émis par `/verify-email`
- **Observabilité :** Sentry via `@sentry/nextjs` (no-op sans DSN) ; `@vercel/otel` pour les traces
- **Outils :** workspace pnpm (un seul package dans `frontend/`), Vitest, ESLint 9 flat config, Prettier, Node 20+

## Variables d'environnement requises (boot)

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | URL pooler Neon (`?pgbouncer=true&connection_limit=1&pool_timeout=15&sslmode=require`) |
| `DIRECT_URL` | URL Neon directe (non-poolée) pour `prisma migrate` |
| `JWT_SECRET` | ≥32 chars, `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | 32 bytes base64, `openssl rand -base64 32` |
| `CRON_SECRET` | Bearer token requis par les handlers `/api/cron/*` ; `openssl rand -base64 32` |
| `APP_URL` | Base des liens email + redirect OAuth ; défaut `http://localhost:3000` |

Groupes optionnels (set les vars pour activer ; absent = inerte) :

| Groupe | Vars | Comportement quand absent |
|---|---|---|
| Paiements (Stripe) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_*` | `POST /api/orders` en carte renvoie 503 `PAYMENT_PROVIDER_UNCONFIGURED` ; Cash App / Zelle restent disponibles |
| Livraison courier | `DOORDASH_*`, `UBER_DIRECT_*` (platform-level, jamais par boutique) | Le provider se présente comme indisponible ; `PICKUP` + `MERCHANT` restent disponibles |
| Storage (Cloudinary) | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_UPLOAD_PRESET?` | `/api/upload` renvoie 503 ; les URLs sont des `secure_url` Cloudinary publiques (OK pour photos produit / logos) |
| Email (Resend) | `RESEND_API_KEY`, `EMAIL_FROM` | Les lignes en queue email s'accumulent, drainées au cron dès que la clé arrive |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | `/api/auth/oauth/google/*` renvoient 404 |
| Captcha (hCaptcha) | `HCAPTCHA_SECRET`, `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` | login / signup / forgot-password ne demandent pas de captcha |
| Sentry | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, … | No-op silencieux |
| Upstash Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Fallback rate-limit en mémoire avec `logger.warn` au boot — NE PAS lancer en prod sans Upstash |

Référence env complète : voir [`.env.example`](.env.example) à la racine (chaque clé documentée avec défaut + impact).

## Surface API

Les route handlers sous [`frontend/src/app/api/`](frontend/src/app/api/) **sont** le contrat — lis-les pour les shapes exactes. Toutes déclarent `export const runtime = 'nodejs'` (enforced par [`runtime-enforcement.test.ts`](frontend/src/lib/server/observability/runtime-enforcement.test.ts)). Grandes familles :

- **`/api/auth/*`** — signup / login / logout / refresh / me / verify-email / forgot-password / reset-password / change-password / set-password / resend-verification, + `/api/auth/oauth/google/{start,callback}`
- **`/api/stores*`** — CRUD boutique du commerçant, `/publish` + `/unpublish` (readiness re-validée serveur), `/stores/me`, `/stores/fulfillment`, `/stores/stripe/*` (onboarding Connect)
- **`/api/products*`**, **`/api/categories*`**, **`/api/inventory/adjust`** — catalogue + ledger de stock append-only
- **`/api/orders`** (checkout invité, server-authoritative), `/api/orders/[id]` (transitions vendeur), `/api/orders/[id]/refund`, `/api/orders/track/[token]` (lecture invité), `/api/cart/validate`
- **`/api/stores/[slug]/delivery-quote`** — devis livraison multi-provider au checkout
- **`/api/discounts*`** — codes promo (FREE_DELIVERY en v1)
- **`/api/notifications*`** — cloche in-app + préférences `{email, inApp}` par type d'événement
- **`/api/webhooks/{stripe,doordash,uber-direct}`** — HMAC raw-body + idempotence + outbox (factory `createWebhookHandler`, PROTÉGÉE)
- **`/api/cron/*`** — 9 handlers, tous `Authorization: Bearer ${CRON_SECRET}` (voir table ci-dessous)
- **`/api/admin/*`** — back-office : users / orders / withdrawals / stores / audit-log / site-content / legal / analytics / pulse (rôle `ADMIN` < `SUPERADMIN`)
- **`/api/upload`** — allowlist MIME + sniff magic-bytes avant Cloudinary
- **`/api/health`**, **`/api/readyz`** — liveness / readiness
- **`/api/csp-report`** — sink des violations CSP Report-Only (voir [`docs/security/csp.md`](frontend/docs/security/csp.md))

### Handlers cron (`frontend/vercel.json`)

| Path | Schedule |
|---|---|
| `/api/cron/outbox-drain` | chaque minute |
| `/api/cron/email-queue-drain` | chaque minute |
| `/api/cron/fulfillment-tick` | toutes les 2 min — dispatch + poll des livraisons courier, purge des devis |
| `/api/cron/order-nudge` | horaire — rappel unique au commerçant si une commande payée stagne |
| `/api/cron/verification-cleanup` | horaire |
| `/api/cron/order-expiration` | toutes les 5 min |
| `/api/cron/webhook-log-purge` | quotidien |
| `/api/cron/email-job-purge` | quotidien |
| `/api/cron/low-stock-sweep` | quotidien — filet de sécurité alertes stock bas |

Requiert un plan **Vercel Pro** (le Hobby ne fait que du quotidien, trop lent pour le TTL de 15 min des codes de vérification).

## Smoke test

`pnpm smoke:auth` lance [`frontend/scripts/smoke-auth.ts`](frontend/scripts/smoke-auth.ts) contre un `pnpm dev` qui tourne : signup → lecture du code de vérification en DB via Prisma → verify-email → `GET /api/auth/me` → logout. Exit 0 sur succès, 1 + log sur échec. Override la cible avec `SMOKE_BASE_URL` pour les previews. Pas dans la CI ; UAT manuel.

## Tests & qualité

Avant tout commit : `pnpm format && pnpm lint && pnpm typecheck && pnpm test` — tout doit passer.

| Tâche | Commande |
|---|---|
| Dev (Turbopack, :3000) | `pnpm dev` |
| Build | `pnpm build` |
| Migrations (dev / prod) | `pnpm db:migrate:dev` / `pnpm db:migrate:deploy` |
| Prisma Studio | `pnpm db:studio` |
| Tests unitaires (Vitest) | `pnpm test` |
| Typecheck / Lint / Format | `pnpm typecheck` / `pnpm lint` / `pnpm format` |

Vitest couvre `frontend/src/lib/server/**` + les route handlers + des tripwires de doc/config. Pas de couche E2E frontend en v1.

## Déploiement Vercel

1. Projet Vercel pointé sur `frontend/` comme root directory (workspace pnpm auto-détecté).
2. Map chaque variable d'environnement (Production + Preview + Development).
3. [`frontend/vercel.json`](frontend/vercel.json) déclare les schedules cron — Vercel les enregistre au deploy.
4. Source-maps Sentry uploadées dans `next build` si `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` sont set en build-time.
5. `output: 'standalone'` auto-détecté (`next.config.ts`).

## Design

Le storefront a 3 templates (`Minimal` / `Modern` / `Bold`), le dashboard commerçant et le back-office admin utilisent le design system Vendylio (tokens dans [`frontend/src/app/globals.css`](frontend/src/app/globals.css) — thème sauge / forêt / corail, polices Inter + Fraunces). Les pages de référence sous [`examples/frontend-pages/`](examples/frontend-pages/) datent du starter et ne sont plus importées — voir les vraies pages sous `frontend/src/app/`.

## Invariants critiques

Voir [CLAUDE.md](CLAUDE.md) pour la liste complète. Version courte :

- Chaque route handler déclare `export const runtime = 'nodejs'`.
- Le prix / sous-total / remise / frais de livraison / taxe / total / commission sont **re-calculés serveur** dans `POST /api/orders` — le client n'est jamais autoritaire.
- Les webhooks lisent le raw body via `req.arrayBuffer()` et vérifient le HMAC **avant** tout `JSON.parse` ; les side-effects passent par l'outbox, jamais par un callback fire-and-forget.
- Le stock passe par `applyStockChange(tx, …)` (écrit `quantity` + une ligne `StockMovement`), jamais d'écriture directe.
- Les retraits utilisent le pattern advisory-lock + tx `Serializable`.
- Les montants sont des entiers dans la plus petite unité (USD = cents).
- Isolation multi-tenant : ressource d'un autre commerçant → **404, pas 403**.
- Le callback OAuth refuse `email_verified !== true`.
- Les handlers cron vérifient `Authorization: Bearer ${CRON_SECRET}`.
- Cookies `httpOnly` + `Secure` (prod) + `SameSite=Lax`.
