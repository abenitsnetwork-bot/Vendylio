# Testing the fulfillment engine

Every provider call in the automated suite is a **mocked `fetch` / mocked
adapter** — the tests never touch a real courier API. Run:

```
pnpm --filter frontend exec vitest run src/lib/server/fulfillment
pnpm --filter frontend exec vitest run src/app/api/webhooks
pnpm --filter frontend exec vitest run src/app/api/stores/fulfillment
```

## Coverage map

| Concern | File(s) |
|---|---|
| State machine (forward-only, terminal corrections, merchant path, `mapToOrderStatus`) | `stateMachine.test.ts` |
| Config normalization + legacy backfill | `config.test.ts` |
| Provider registry (all 4 types resolve, friendly names) | `registry.test.ts` |
| Provider → normalized status mapping (Uber + DoorDash incl. UNKNOWN) | `providers/status-mapping.test.ts` |
| Merchant / pickup quote + no-op create | `providers/merchant.test.ts` |
| DoorDash adapter (quote, create, `duplicate_delivery_id` → GET+hydrate, timeout, cancel, testConnection) | `providers/doordash.test.ts` |
| DoorDash JWT (header/claims/exp/signature) | `providers/doordash-jwt.test.ts` |
| `recordTransition` (idempotency, out-of-order, order-status mapping, legacy dual-write) | `service.test.ts` |
| `createFulfillment` (dispatch, retry-below-cap, cap → FAILED + notify, reconcile) | `service.test.ts` |
| `applyCourierWebhookEvent` (correlation, terminal notifications, dedupe) | `service.test.ts` |
| `createQuote` / `priceDeliveryForOrder` (parallel quotes, bind-check, re-quote, 409) | `service.test.ts` |
| `fulfillment-tick` cron core (claim, poll, purge, **stale-delivery sweep**) | `dispatch.test.ts`, `cron/fulfillment-tick/route.test.ts` |
| Request timeout + error taxonomy (`fetchWithTimeout`, `withTimeout`, `classifyDeliveryError`) | `http.test.ts` |
| Terminal side-effect funnel (DELIVERED/FAILED/CANCELLED emit once, per-actor customer-email gate, dedupe) | `service.test.ts` |
| Provider-not-enabled bypass rejected at checkout (`resolveOrderProviderType`, `priceDeliveryForOrder`) | `config.test.ts`, `service.test.ts`, `security.test.ts` |
| Webhook routes (signature, funnel, no-op on unknown) | `app/api/webhooks/{uber-direct,doordash}/route.test.ts` |
| `markPaid` opens a PENDING Delivery for delivery orders only | `orders/markPaid.test.ts` |
| Checkout re-price / quote validation | `orders/route.test.ts` |
| Merchant settings + IDOR + test-connection | `stores/fulfillment/route.test.ts`, `.../test-connection/route.test.ts` |
| Cancel route (IDOR, 409 refusal) | `orders/[id]/delivery/cancel/route.test.ts` |

## Real sandbox validation (Prompt #13.5)

The automated suite above is **100% mocked**. To check the adapters against the
real courier sandboxes, use the isolated harness (never runs in CI):

```
RUN_PROVIDER_SANDBOX_TESTS=1 pnpm --filter frontend provider:sandbox-check
```

It drives the shipped adapters (`getDeliveryProvider(...)`) — `testConnection()`
+ `quote()`, and with `RUN_PROVIDER_SANDBOX_CREATE=1` also create → status →
cancel. Aborts on `NODE_ENV=production` and without the per-courier `*_SANDBOX`
flag. Full walkthrough incl. the webhook loop: `sandbox-runbook.md`.

### Result matrix template (spec §42)

| Provider | Operation | Result | Notes |
|----------|-----------|--------|-------|
| Uber | Auth / Quote / Create / Status / Cancel / Webhook / Signature | PASS/BLOCKED/FAIL | |
| DoorDash | Auth / Quote / Create / Status / Cancel / Webhook / Signature | PASS/BLOCKED/FAIL | |

### Recorded result — 2026-08-31 / 2026-09-01

| Provider | Operation | Result | Evidence |
|----------|-----------|--------|----------|
| Uber Direct | Auth | **PASS** | real 177-char OAuth token from `login.uber.com` |
| Uber Direct | Quote / Create / Status / Cancel / Webhook | **BLOCKED** | app has no Client-Credentials scopes ("contact your Uber business development representative"); account also flagged disabled (`directbilling-group@uber.com`). Uber Direct is **sales-gated, not self-serve.** |
| DoorDash | Auth | **PASS** | self-signed JWT accepted by `openapi.doordash.com/drive/v2` |
| DoorDash | Quote | **PASS** | live quote, `fee: 975` (USD) for the SF test pair |
| DoorDash | Create | **PASS** | `POST /deliveries` → `delivery_status: created` → normalized `REQUESTED` |
| DoorDash | Status | **PASS** | `GET /deliveries/{id}` → `created` → `REQUESTED` |
| DoorDash | Cancel | **PASS** | `PUT /deliveries/{id}/cancel` → `200 cancelled` (sandbox blocks cancel for ~60 s after create; the adapter surfaces "try again in 1 minute" gracefully, no crash) |
| DoorDash | Webhook / Signature | **PENDING** | needs a public tunnel + dashboard webhook registration (runbook step 5) |
| Both | offline adapter / webhook-signature / JWT / security audit | **PASS** | full mocked suite + code audit |

DoorDash Drive account is "Pending activation" (production) but the sandbox is
live on the same host + credentials — the full quote → create → status → cancel
cycle is validated against the real API.

"Mock automated tests: PASS" and "Uber sandbox: BLOCKED" are both honest,
distinct results — a `PASS` here means a real sandbox call succeeded, nothing
less.

## Manual UAT (against a running `pnpm dev`)

See the "Verification" section of the plan
(`.claude/plans/tingly-cooking-cocoa.md`). Key checks: sandbox creds only;
`test-connection` creates nothing; fire a sandbox `delivered` webhook twice →
one email + one notification; tamper the `deliveryFee` in the `POST /api/orders`
body → the server value wins.

## Production readiness checklist

**Environment**
- [ ] Uber Direct + / or DoorDash **production** credentials set (`docs/fulfillment/env-vars.md`)
- [ ] Webhook URLs registered with each provider; `*_WEBHOOK_*` secrets set
- [ ] `CRON_SECRET` set; `fulfillment-tick` scheduled (Vercel Pro — 2 min)
- [ ] Stripe payment configured (delivery is never dispatched before payment)

**Security**
- [ ] `security.test.ts` green — no `DOORDASH_` / `UBER_DIRECT_` env read outside `lib/server`
- [ ] `POST /api/orders` ignores any body `deliveryFee` / total; provider decided server-side
- [ ] Webhook signature verification on (invalid signature → no state change)
- [ ] Delivery routes 404 (not 403) for a non-owner order

**Reliability**
- [ ] Idempotency: duplicate webhook / duplicate retry → one delivery, one email
- [ ] Every provider call time-boxed (`FULFILLMENT_PROVIDER_TIMEOUT_MS`)
- [ ] Missed terminal webhook → the poll cron advances state **and** emits the email
- [ ] Advisory lock + Serializable on all four write paths (retry / webhook / cron / cancel)
- [ ] Retry never creates a second external delivery when one is live (reconciles)

**Operations**
- [ ] Merchant can see delivery status, Retry (only when valid), Cancel (only when valid)
- [ ] `fulfillment-tick` response exposes `stale*` counters; `log.warn` on stale
- [ ] Customer tracking shows a human status + ETA only when the provider gave one
- [ ] Pickup + Merchant delivery work with **no** courier API calls
