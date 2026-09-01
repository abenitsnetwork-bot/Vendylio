# Fulfillment engine — environment variables

All **platform-level** — one set for the whole app. A courier with no
credentials set is simply hidden at checkout (no error). See section 9 of
`.env.example`.

## Uber Direct

| Var | Purpose |
|---|---|
| `UBER_DIRECT_CLIENT_ID` / `UBER_DIRECT_CLIENT_SECRET` | OAuth client for outbound API calls |
| `UBER_DIRECT_CUSTOMER_ID` | Organization ID that scopes delivery/quote calls |
| `UBER_DIRECT_WEBHOOK_SIGNING_KEY` | Per-webhook HMAC key (`x-uber-signature`) |
| `UBER_DIRECT_SANDBOX_TEST_MODE` | `1` = attach the robo-courier test spec (sandbox auto-completes, no real driver) |

## DoorDash Drive

| Var | Purpose |
|---|---|
| `DOORDASH_DEVELOPER_ID` / `DOORDASH_KEY_ID` / `DOORDASH_SIGNING_SECRET` | JWT signing credentials (see `doordash.md`) |
| `DOORDASH_WEBHOOK_SECRET` | HMAC key (`X-DoorDash-Signature`) — preferred |
| `DOORDASH_WEBHOOK_USERNAME` / `DOORDASH_WEBHOOK_PASSWORD` | Basic-Auth fallback for the webhook |
| `DOORDASH_SANDBOX` | `1` = sandbox intent (use sandbox credentials; auto Dasher simulation) |

## Engine tunables (safe defaults shipped)

| Var | Default | Purpose |
|---|---|---|
| `FULFILLMENT_DISPATCH_MAX_ATTEMPTS` | `6` | create-delivery attempts before `fulfillment-tick` marks the `Delivery` FAILED (recoverable via the seller's Retry) |
| `FULFILLMENT_QUOTE_TIMEOUT_MS` | `4000` | per-provider checkout-quote timeout — a slow courier drops out instead of stalling checkout |
| `FULFILLMENT_QUOTE_FALLBACK_TTL_SECONDS` | `300` | how long a flat-fee (merchant) quote stays valid; courier quotes carry the provider's own expiry |
| `FULFILLMENT_PROVIDER_TIMEOUT_MS` | `10000` | hard deadline on every non-quote provider call (create / get / cancel delivery). A timeout is treated exactly like a provider error — attempt bump, then FAILED at the cap. |
| `FULFILLMENT_STALE_DISPATCH_MINUTES` | `30` | `fulfillment-tick` **warns** (never cancels) when a PENDING courier delivery for a READY order hasn't dispatched in this long |
| `FULFILLMENT_STALE_UNASSIGNED_MINUTES` | `20` | warn when a REQUESTED delivery still has no courier assigned |
| `FULFILLMENT_STALE_IN_TRANSIT_HOURS` | `4` | warn when a PICKED_UP / OUT_FOR_DELIVERY delivery has been in transit this long (probable missed terminal) |

## Cron

`fulfillment-tick` runs every 2 minutes (`frontend/vercel.json`), gated by
`Authorization: Bearer ${CRON_SECRET}` like every other cron.
