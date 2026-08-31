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
| `service.ts` | `recordTransition`, `initFulfillment`, `handleProviderEvent`, `selectProvider`, `quoteMethod`. Every write to `Delivery.state` / `Order.status` goes through here. |
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

## Later phases

- **Phase 2** — safe payment sequence (`markPaid` → `initFulfillment` PENDING),
  the `fulfillment-tick` cron (dispatch + poll + quote purge).
- **Phase 3** — real DoorDash Drive adapter + webhook + normalized checkout quotes.
- **Phase 4** — multi-method checkout, server re-quote, tracking DTO.
- **Phase 5** — merchant config UI, order-detail fulfillment card, cancel, docs, security sweep.
