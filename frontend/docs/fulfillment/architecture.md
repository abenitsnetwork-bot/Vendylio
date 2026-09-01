# Delivery & Fulfillment Engine — architecture

_Prompt #12. This document grows across phases; Phase 1 lays the core._

## The idea

The rest of Vendylio (checkout, orders, tracking, the seller dashboard) never
talks to Uber or DoorDash. It talks to the **fulfillment engine**, which owns
every provider-specific detail:

```
Checkout → Order → Fulfillment Engine → Delivery provider (Uber / DoorDash / Merchant / Pickup)
```

## Modules (`src/lib/server/fulfillment/`)

| File | Responsibility |
|---|---|
| `types.ts` | The normalized vocabulary — `ProviderType`, `NormalizedState`, `DeliveryQuote`, `ProviderSnapshot`, DTOs. Everything outside `providers/*` speaks only these. |
| `provider.ts` | The `FulfillmentProvider` interface (v2) + capability flags. |
| `stateMachine.ts` | `rank()`, `canTransition(from, to, actor)`, `mapToOrderStatus()`. Pure. The single authority on which state changes are legal and what they mean for `Order.status`. |
| `config.ts` | `readFulfillmentConfig(store)` — normalizes the `Store.fulfillmentConfig` JSON blob, backfilling from the legacy `deliveryProvider` / `deliveryFeeCents` columns. |
| `registry.ts` | `getDeliveryProvider(type)` — **the only** `ProviderType → adapter` switch in the codebase. |
| `service.ts` | `recordTransition`, `initFulfillment`, `handleProviderEvent`, `selectProvider`, `quoteMethod`, `createFulfillment`, `cancelFulfillment`, `applyCourierWebhookEvent`. Every write to `Delivery.state` / `Order.status` goes through here. |
| `http.ts` | Prompt #13 — `fetchWithTimeout` / `withTimeout` (every outbound provider call is time-boxed) + `classifyDeliveryError` (raw provider error → stable `DELIVERY_*` code). |
| `providers/pickup.ts` | No courier, no API — the buyer collects in person. |
| `providers/merchant.ts` | The seller is their own courier (the historical `self_manual`). Flat fee + min-order gate from config. |
| `providers/uber-direct.ts` | v2 wrapper over the Phase-5 `lib/server/delivery/uber-direct.ts` SDK integration. |
| `providers/doordash.ts` | DoorDash Drive. Phase 1 = inert stub; Phase 3 = real. |

## The state machine

```
PENDING → QUOTED → REQUESTED → CONFIRMED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
terminal: CANCELLED, FAILED
```

- **Provider / cron events** are forward-only. A replayed or out-of-order
  lower-rank event is recorded as a `DeliveryEvent` (forensics) but does not
  move `Delivery.state` — the same "furthest reached wins, never regress" rule
  the customer order timeline already uses.
- **Merchant actions** (self-delivery only) walk `PENDING → REQUESTED →
  OUT_FOR_DELIVERY → DELIVERED`, plus `* → CANCELLED`.
- A provider status string we don't recognise normalizes to `UNKNOWN`:
  recorded + logged, state untouched, never crashes.

`mapToOrderStatus`: a delivery being arranged (PENDING…CONFIRMED) leaves the
order where the seller has it; PICKED_UP / OUT_FOR_DELIVERY → order
`OUT_FOR_DELIVERY`; DELIVERED → order `DELIVERED`; FAILED / CANCELLED → order
`READY` **only if** it is currently `OUT_FOR_DELIVERY`. An order is **never**
auto-cancelled or auto-refunded by a delivery failure.

### Terminal side-effects — one funnel (Prompt #13)

When a delivery reaches DELIVERED / FAILED / CANCELLED, `recordTransition`
(and only it) enqueues the seller notification + the customer status email via
`enqueueDeliveryTerminalEffects`. Every write path funnels through
`recordTransition`, so the emit is exactly-once regardless of who observed the
terminal first — courier webhook, `fulfillment-tick` poll, the Retry route's
reconcile, or a merchant "Mark delivered" click. All four write paths also take
the same `pg_advisory_xact_lock(hashtext(deliveryId))` inside a `Serializable`
tx, so a retry racing a webhook racing the cron produces one deterministic
final state, never a duplicate delivery or event.

## Data model

- `Delivery` gains the engine columns (`state`, `providerType`,
  `externalDeliveryId`, quote snapshot, ETAs, timestamps, `attemptCount`, …).
  The Phase-5 `status` / `provider` columns are **kept and dual-written** so
  the guest tracking route and the dashboard keep working; a later migration
  drops them.
- `DeliveryEvent` — append-only history + the webhook/poll idempotency gate
  (`@@unique([deliveryId, providerEventId])`).
- `Quote` — persisted checkout quotes; the chosen one is re-validated /
  re-quoted server-side at payment.
- `Store.fulfillmentConfig` (JSON) — per-method enable/config.

## Credentials

**Platform-level.** One Uber Direct account and one DoorDash Drive account for
the whole platform, in server env vars. The merchant UI toggles methods on and
off; it never stores a secret.

## The safe payment sequence

```
Checkout → POST /api/orders (priceDeliveryForOrder — authoritative fee)
         → Stripe → PAID
         → markPaid.initFulfillment  →  Delivery { state: PENDING }   (no external call)
         → fulfillment-tick cron     →  createFulfillment  →  provider.createDelivery
                                     →  Delivery { state: REQUESTED, externalDeliveryId }
         → webhook / poll            →  applyCourierWebhookEvent / handleProviderEvent
                                     →  … CONFIRMED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
```

A paid order whose courier request permanently fails: `Order` stays PAID, the
`Delivery` goes `FAILED` with a `failureReason`, the merchant gets a
`FULFILLMENT_FAILED` notification and a **Retry** button on the order detail
page. Never an auto-cancel, never an auto-refund.

## Idempotency & concurrency

| Layer | Mechanism |
|---|---|
| one Delivery per order | `Delivery.orderId @unique` + `markPaid` upsert in the payment tx |
| one dispatch per Delivery | `fulfillment-tick` claim (`state PENDING → DISPATCHING`) + `attemptCount` |
| cross-worker | `pg_advisory_xact_lock(hashtext(deliveryId))` in every Delivery-mutating service tx |
| provider-level | stable `externalDeliveryId` (`vend_<id>`); DoorDash `duplicate_delivery_id` → GET + hydrate |
| webhook / poll replay | `DeliveryEvent @@unique([deliveryId, providerEventId])` (poll keyed `poll:<rawStatus>`) |

## Routes

| Route | Purpose |
|---|---|
| `POST /api/stores/[slug]/delivery-quote` | checkout option array (public) |
| `POST /api/orders` | authoritative fee via `priceDeliveryForOrder` |
| `GET`/`PATCH /api/stores/fulfillment` | merchant per-method config |
| `POST /api/stores/fulfillment/test-connection` | safe credential probe |
| `POST`/`PATCH /api/orders/[id]/delivery` | seller "request delivery" (dispatch now) / "mark delivered" |
| `POST /api/orders/[id]/delivery/cancel` | seller cancel (courier may refuse → 409) |
| `POST /api/webhooks/{uber-direct,doordash}` | courier status webhooks |
| `POST /api/cron/fulfillment-tick` | dispatch + poll + quote purge (every 2 min) |

## Non-goals (V1)

No driver app, no payroll, no fleet management, no route optimization, no AI, no
marketplace commission on delivery, no automatic provider failover, no partial
refunds, no distance-based merchant pricing, no multi-currency (US/USD default,
core code stays country-agnostic).
