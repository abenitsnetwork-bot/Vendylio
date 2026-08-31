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
| `fulfillment-tick` cron core (claim, poll, purge) | `dispatch.test.ts`, `cron/fulfillment-tick/route.test.ts` |
| Webhook routes (signature, funnel, no-op on unknown) | `app/api/webhooks/{uber-direct,doordash}/route.test.ts` |
| `markPaid` opens a PENDING Delivery for delivery orders only | `orders/markPaid.test.ts` |
| Checkout re-price / quote validation | `orders/route.test.ts` |
| Merchant settings + IDOR + test-connection | `stores/fulfillment/route.test.ts`, `.../test-connection/route.test.ts` |
| Cancel route (IDOR, 409 refusal) | `orders/[id]/delivery/cancel/route.test.ts` |

## Manual UAT (against a running `pnpm dev`)

See the "Verification" section of the plan
(`.claude/plans/tingly-cooking-cocoa.md`). Key checks: sandbox creds only;
`test-connection` creates nothing; fire a sandbox `delivered` webhook twice →
one email + one notification; tamper the `deliveryFee` in the `POST /api/orders`
body → the server value wins.
