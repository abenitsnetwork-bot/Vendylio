# DoorDash Drive — setup

_Prompt #12, Phase 3. Platform-level: one DoorDash Drive account for all of Vendylio._

## Credentials

From the [DoorDash Developer Portal](https://developer.doordash.com) → your
Drive project → **Credentials**, you get three values:

| Env var | Portal field |
|---|---|
| `DOORDASH_DEVELOPER_ID` | Developer ID |
| `DOORDASH_KEY_ID` | Key ID |
| `DOORDASH_SIGNING_SECRET` | Signing Secret (base64) |

DoorDash Drive has **no token endpoint**. The client self-signs a short-lived
JWT from these three values on every request:

- header `{ "alg": "HS256", "typ": "JWT", "dd-ver": "DD-JWT-V1" }`
- claims `{ "aud": "doordash", "iss": <developer_id>, "kid": <key_id>, "exp": now+300, "iat": now }`
- signed with `HMAC-SHA256`, key = `base64_decode(signing_secret)`, output base64url

See [`src/lib/server/fulfillment/providers/doordash-jwt.ts`](../../src/lib/server/fulfillment/providers/doordash-jwt.ts).

## Sandbox

Set `DOORDASH_SANDBOX="1"` and use your **sandbox** developer credentials. The
same host (`https://openapi.doordash.com/drive/v2`) is used; sandbox deliveries
run through DoorDash's Dasher simulator — no real driver is ever dispatched.
`DOORDASH_SANDBOX` is currently informational (the adapter does not change hosts);
it documents intent and is a hook for future host switching.

Never run the automated test suite against production credentials — every
provider call in tests is a mocked `fetch`.

## Webhook

Configure a Drive webhook in the portal pointing at
`https://<your-domain>/api/webhooks/doordash`. Authenticate it with **either**:

- **HMAC (preferred):** set `DOORDASH_WEBHOOK_SECRET`. DoorDash signs each body
  with hex `HMAC-SHA256`; we compare it against the `X-DoorDash-Signature`
  header (byte-identical scheme to the Uber Direct verifier).
- **Basic Auth (fallback):** set `DOORDASH_WEBHOOK_USERNAME` +
  `DOORDASH_WEBHOOK_PASSWORD` if your account only offers Basic Auth on the
  webhook endpoint.

If neither is set the webhook returns 401 for every request.

## What the adapter does

| Operation | Endpoint |
|---|---|
| quote (pricing only) | `POST /drive/v2/quotes` |
| create delivery | `POST /drive/v2/deliveries` |
| get delivery | `GET /drive/v2/deliveries/{external_delivery_id}` |
| cancel delivery | `PUT /drive/v2/deliveries/{external_delivery_id}/cancel` |

- **`external_delivery_id`** is Vendylio-controlled: `vend_<deliveryId>` for a
  real delivery, `quote_<uuid>` for a throwaway pricing quote.
- A `duplicate_delivery_id` conflict (HTTP 409) is treated as "already
  created" — the adapter `GET`s the delivery and hydrates, never dispatching a
  second one.
- Status strings are normalized in `normalizeDoorDashStatus` (`created` →
  REQUESTED, `dasher_confirmed` → CONFIRMED, `picked_up` → PICKED_UP,
  `en_route_to_dropoff` → OUT_FOR_DELIVERY, `delivered` → DELIVERED,
  `cancelled` → CANCELLED, `delivery_attempt_failed`/`returned` → FAILED, else
  → UNKNOWN).

## Test connection

The merchant "Test connection" button (`POST /api/stores/fulfillment/test-connection`,
Phase 5) does a `GET` for a random nonexistent delivery id — a `404` proves the
JWT authenticated and **never dispatches a driver**.

## Sandbox validation status — 2026-09-01

Validated against the **real** DoorDash Drive sandbox
(`openapi.doordash.com/drive/v2`, account "Pending activation" = sandbox mode)
with `provider:sandbox-check`:

| Op | Result | Detail |
|---|---|---|
| Auth | **PASS** | self-signed HS256 JWT accepted |
| Quote | **PASS** | `POST /quotes` → `fee: 975` USD, SF test pair |
| Create | **PASS** | `POST /deliveries` → `created` → `REQUESTED` |
| Status | **PASS** | `GET /deliveries/{id}` → `created` → `REQUESTED` |
| Cancel | **PASS** | `PUT /deliveries/{id}/cancel` → `200 cancelled` (sandbox refuses cancel for ~60 s post-create; adapter returns the "try again" reason without crashing) |
| Webhook / Signature | **PENDING** | needs a tunnel + dashboard webhook (runbook step 5) + the DoorDash **Delivery Simulator** to advance statuses |

The JWT signer, `AbortController` timeouts, `duplicate_delivery_id` → GET+hydrate,
and the HMAC/Basic webhook verifier were already green in the mocked suite
(`providers/doordash.test.ts`, `doordash-jwt.test.ts`). Phone numbers must use a
real US area code — a `555` area code gets `validation_error` (the harness
defaults to `+1650…`).
