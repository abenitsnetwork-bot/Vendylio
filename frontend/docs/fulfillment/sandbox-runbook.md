# Provider sandbox runbook

Step-by-step for validating the **existing** Uber Direct / DoorDash Drive
adapters against the real courier sandboxes. Nothing here changes the engine —
it exercises what's already shipped.

> All commands run from the repo root unless noted. `pnpm -F frontend` ==
> `pnpm --filter frontend`.

## 1. Configure credentials

Put sandbox credentials in `frontend/.env.local` (git-ignored — never commit):

```
# Uber Direct  (developer.uber.com/dashboard — a SANDBOX app)
UBER_DIRECT_CLIENT_ID="..."
UBER_DIRECT_CLIENT_SECRET="..."
UBER_DIRECT_CUSTOMER_ID="..."
UBER_DIRECT_WEBHOOK_SIGNING_KEY="..."
UBER_DIRECT_SANDBOX_TEST_MODE="1"

# DoorDash Drive  (developer.doordash.com — Drive project + sandbox business/store)
DOORDASH_DEVELOPER_ID="..."
DOORDASH_KEY_ID="..."
DOORDASH_SIGNING_SECRET="..."
DOORDASH_WEBHOOK_SECRET="..."
DOORDASH_SANDBOX="1"
```

Uber Direct has **no separate sandbox host** — `api.uber.com` is used for both.
"Sandbox" = a sandbox developer app + `UBER_DIRECT_SANDBOX_TEST_MODE=1` (attaches
the robo-courier test spec so deliveries auto-complete with no real driver /
no charge). Keep sandbox and production credentials in different environments;
there is **no** "sandbox missing → fall back to production" path in the code.

> **Known gotcha:** a newly-created Uber Direct account returns
> `400 invalid_params` with `metadata.param_details: "This account has been
> disabled. Please reach out to directbilling-group@uber.com to resolve"` on
> every quote / create call until Uber activates billing on it. `getAccessToken`
> still succeeds, so *auth* looks green while *everything else* is blocked.
> Resolve account activation with Uber before expecting quote/create to work.

## 2. Verify you are NOT pointed at production

```
grep -E 'UBER_DIRECT_SANDBOX_TEST_MODE|DOORDASH_SANDBOX' frontend/.env.local
```

Both must be `"1"`. The harness refuses to hit a courier whose `*_SANDBOX` flag
is unset, and refuses to run at all under `NODE_ENV=production`.

## 3. Connection + quote check (no delivery created)

```
RUN_PROVIDER_SANDBOX_TESTS=1 pnpm -F frontend provider:sandbox-check
```

Prints the result matrix (`PASS` / `FAIL` / `BLOCKED` / `BLOCKED_BY_CREDENTIALS`).
This calls the real adapters (`getDeliveryProvider(...)`) — `testConnection()`
then `quote()`. It never creates a delivery.

## 4. Full create → status → cancel (opt-in)

```
RUN_PROVIDER_SANDBOX_TESTS=1 RUN_PROVIDER_SANDBOX_CREATE=1 \
  pnpm -F frontend provider:sandbox-check
```

Creates one sandbox delivery per configured+enabled courier, reads its status,
then cancels it. Uber robo-courier / DoorDash auto-Dasher mean no real driver.

## 5. Webhook loop (needs a tunnel + a running app)

```
pnpm dev                                   # terminal 1
cloudflared tunnel --url http://localhost:3000   # terminal 2  (or: ngrok http 3000)
```

Register the tunnel URL in each provider dashboard:

- Uber Direct → webhook `https://<tunnel>/api/webhooks/uber-direct`, copy its
  signing key into `UBER_DIRECT_WEBHOOK_SIGNING_KEY`.
- DoorDash → webhook `https://<tunnel>/api/webhooks/doordash`, set
  `DOORDASH_WEBHOOK_SECRET` (or the Basic-Auth pair).

Then:

1. Create a sandbox delivery (step 4, or a real checkout on a seeded store).
2. Advance it — Uber robo-courier auto-advances; DoorDash uses the **delivery
   simulator** in the dashboard.
3. Watch the app logs: signature verify → `applyCourierWebhookEvent` →
   `DeliveryEvent` written → `Delivery.state` / `Order.status` updated.
4. **Replay:** re-send the same `delivered` webhook. Expect: second call is a
   no-op (WebhookLog / `DeliveryEvent @@unique` dedup) — exactly one customer
   email + one seller notification total.
5. **Tamper:** change one byte of the payload but keep the old signature →
   `401`, no state change.

## 6. Verify the database

```
pnpm -F frontend db:studio
```

Check `Delivery` (one row per order, correct `state` / `providerType` /
`externalDeliveryId`), `DeliveryEvent` (append-only, no duplicate
`(deliveryId, providerEventId)`), `Quote` (checkout quotes, purged when stale),
`Order.status` consistent with `mapToOrderStatus`.

## 7. Reconciliation

Skip a webhook on purpose (don't fire step 5), then hit the poll cron:

```
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/fulfillment-tick
```

The poll's `getDelivery` observes the terminal state and — via
`recordTransition` → `enqueueDeliveryTerminalEffects` — emits the **same**
customer email + seller notification the webhook would have. Response body
carries `staleDispatch` / `staleUnassigned` / `staleInTransit` counters.

## 8. Clean up

Cancel any still-open sandbox deliveries (step 4 does this automatically; the
dashboard's simulator can also cancel). Sandbox deliveries never bill, but
leaving them `OUT_FOR_DELIVERY` clutters the poll cron's in-flight set.

## Payment safety

Always use the payment provider's **test mode**. A failed payment must create
**no** courier delivery — `markPaid` is the only path that writes a
`Delivery{PENDING}`, and the courier is dispatched later by `fulfillment-tick`
only once the order is `READY`.
