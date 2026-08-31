# Merchant delivery configuration

Merchants configure fulfillment at **Dashboard → Delivery & Fulfillment**
(`/dashboard/delivery`), backed by `GET` / `PATCH /api/stores/fulfillment`.

## What a merchant controls

| Method | Toggle | Extra config |
|---|---|---|
| Uber Direct | on/off + **Test connection** | none (platform credentials) |
| DoorDash | on/off + **Test connection** | none (platform credentials) |
| Merchant delivery | on/off | flat fee, minimum order, delivery instructions |
| Customer pickup | on/off | pickup instructions (store address is reused) |
| — | "Let customers choose their courier" | when >1 courier is serviceable: on = buyer picks at checkout; off = cheapest wins automatically |

Stored in `Store.fulfillmentConfig` (JSON). A store that predates the engine is
backfilled from its legacy `deliveryProvider` / `deliveryFeeCents` columns, so
behaviour is unchanged until the merchant opens the page.

## Provider config-state

`GET /api/stores/fulfillment` returns a `providerStates` map:

| State | Meaning |
|---|---|
| `ENABLED` | on **and** platform credentials present → appears at checkout |
| `CONFIGURED` | credentials present, merchant has it off |
| `DISABLED` | off, no credentials |
| `UNAVAILABLE` | merchant turned it on but the platform credentials aren't set — won't appear at checkout; a `warnings[]` entry says so |

Config-state is **not** runtime health — one failed provider call never
disables a method.

## Test connection

`POST /api/stores/fulfillment/test-connection` `{ provider }` calls the
adapter's `testConnection()`, which authenticates and stops. It **never**
creates a quote or a delivery, so it can never dispatch a real driver.
