# Fulfillment webhooks

_Prompt #12._

## Endpoints

| Provider | Endpoint | Auth | Correlation |
|---|---|---|---|
| Uber Direct | `POST /api/webhooks/uber-direct` | `x-uber-signature` — hex HMAC-SHA256 of the raw body, key `UBER_DIRECT_WEBHOOK_SIGNING_KEY` | `payload.delivery_id` → `Delivery.providerDeliveryId` |
| DoorDash Drive | `POST /api/webhooks/doordash` | `X-DoorDash-Signature` (HMAC, `DOORDASH_WEBHOOK_SECRET`) **or** Basic Auth (`DOORDASH_WEBHOOK_USERNAME` / `_PASSWORD`) | `payload.external_delivery_id` → `Delivery.externalDeliveryId` |

Both routes are thin shims over the PROTECTED `createWebhookHandler` factory
(raw-body read, signature verify, Serializable tx, `WebhookLog` dedup) and
funnel every state change through **one** entry point:
`fulfillmentService.applyCourierWebhookEvent`.

## Terminal-only + a poll cron

The factory has three event slots — `onPaid` / `onRefunded` / `onFailed`. We map:

- provider "delivered" → `onPaid`
- provider "cancelled" / "failed" / "returned" → `onFailed`
- everything else (courier assigned, picked up, en route) → dropped by the factory

Intermediate courier states are **not** taken from webhooks (that would need a
change to the PROTECTED factory). Instead the `fulfillment-tick` cron polls
every in-flight courier delivery via the provider's GET-status API roughly
every 2 minutes and folds the snapshot through the same
`handleProviderEvent` → state machine. So "picked up" / "on the way" can lag by
up to the poll interval; the terminal states are real-time via the webhook.
The poll is also a safety net for a missed terminal webhook.

## Idempotency

- `WebhookLog @@unique([externalId, eventType])` — the factory drops a replayed
  event before it reaches our handler.
- `DeliveryEvent @@unique([deliveryId, providerEventId])` — a second look at the
  same event (or a repeated poll of the same status, keyed `poll:<rawStatus>`)
  records nothing new and moves no state, so notifications never duplicate.
- The state machine is forward-only: an out-of-order lower-rank event is
  recorded for forensics but never regresses `Delivery.state`.

## Testing against a real account

Uber Direct and DoorDash both provide dashboard "test webhook" / simulator
tools. Fire a `delivered` event twice and confirm exactly one
`notification.delivery_completed` + one `email.order_status` are enqueued.
