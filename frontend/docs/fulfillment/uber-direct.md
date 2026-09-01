# Uber Direct

The original courier integration, now a v2 provider behind the engine
(`src/lib/server/fulfillment/providers/uber-direct.ts` wraps the SDK layer in
`src/lib/server/delivery/uber-direct.ts`).

## Credentials (platform-level)

| Env var | Where to get it |
|---|---|
| `UBER_DIRECT_CLIENT_ID` / `UBER_DIRECT_CLIENT_SECRET` | Uber Direct dashboard → your app → **Credentials** (OAuth 2.0 client-credentials) |
| `UBER_DIRECT_CUSTOMER_ID` | dashboard → **Organization** → Customer ID |
| `UBER_DIRECT_WEBHOOK_SIGNING_KEY` | dashboard → **Webhooks** → the endpoint's signing secret |
| `UBER_DIRECT_SANDBOX_TEST_MODE` | `"1"` in non-prod — attaches the robo-courier test spec so sandbox deliveries auto-complete |

All are server-only. They are read exclusively under `src/lib/server/delivery/` and
`src/lib/server/fulfillment/providers/`; a test in
`src/lib/server/fulfillment/security.test.ts` fails CI if a `UBER_DIRECT_` env reference
appears anywhere outside `lib/server`.

## Auth

OAuth 2.0 client-credentials → a bearer token, cached module-level (`getCachedAccessToken`,
single-instance — the same documented limitation as the DoorDash JWT cache).

## API surface used

| Op | In code |
|---|---|
| quote | `getUberDirectDeliveryFeeCents`, `checkPickupAddressDeliverable` |
| create | `createUberDirectProvider().requestDelivery` |
| get | `getUberDelivery(providerDeliveryId)` |
| cancel | `cancelUberDelivery(providerDeliveryId)` |

Base URL `https://api.uber.com/v1`, path `/customers/{UBER_DIRECT_CUSTOMER_ID}/deliveries…`.

## Status normalization

`normalizeUberStatus()` (`providers/uber-direct.ts`):

| Uber status | Normalized |
|---|---|
| `pending` | `REQUESTED` |
| `pickup` | `CONFIRMED` |
| `pickup_complete` | `PICKED_UP` |
| `dropoff` | `OUT_FOR_DELIVERY` |
| `delivered` | `DELIVERED` |
| `canceled` / `cancelled` | `CANCELLED` |
| `returned` | `FAILED` |
| anything else | `UNKNOWN` (recorded + logged, state untouched) |

## Webhook

`POST /api/webhooks/uber-direct` — `x-uber-signature` is a hex HMAC-SHA256 of the **raw**
body keyed by `UBER_DIRECT_WEBHOOK_SIGNING_KEY`, verified before any JSON parse by the
PROTECTED `createWebhookHandler` factory. Terminal events only; intermediate states come
from the `fulfillment-tick` poll cron. Correlation: `payload.delivery_id` →
`Delivery.providerDeliveryId`. Both `onPaid` and `onFailed` funnel through
`fulfillmentService.applyCourierWebhookEvent`.

## Test connection

`uberDirectAuthProbe()` fetches an OAuth token and stops. It never calls the deliveries
endpoint, so it cannot dispatch a driver. **Caveat:** a green probe only proves OAuth
works — it does not prove the Uber account is provisioned for deliveries (see below).

## Sandbox validation status — 2026-08-31

Checked with `pnpm --filter frontend provider:sandbox-check` against real sandbox
credentials:

| Op | Result | Detail |
|---|---|---|
| Auth (`getAccessToken`) | **PASS** | real 177-char bearer token from `login.uber.com` |
| Quote / Create / Status / Cancel | **BLOCKED** | Uber account disabled — `400 invalid_params`, `param_details: "This account has been disabled. Please reach out to directbilling-group@uber.com to resolve"` |
| Webhook loop | **BLOCKED** | needs an enabled account + a tunnel |

The adapter's request shapes therefore remain **unverified against a live,
enabled account**. The SDK's `getDelivery` / `listDeliveries` / `cancelDelivery`
helpers do exist in v0.1.8 — the adapter calls the endpoints with
`fetchWithTimeout` directly for a hard deadline. Once Uber enables the account,
re-run the harness with `RUN_PROVIDER_SANDBOX_CREATE=1` and follow
`sandbox-runbook.md`.
