# Sandbox setup

For the full validation walkthrough (tunnel, webhook replay, DB checks,
reconciliation) see **`sandbox-runbook.md`**. Quick check once credentials are
in `.env.local`:

```
RUN_PROVIDER_SANDBOX_TESTS=1 pnpm --filter frontend provider:sandbox-check
```

## Uber Direct

1. Create an Uber Direct app at <https://developer.uber.com/dashboard>.
2. Copy `UBER_DIRECT_CLIENT_ID` / `_CLIENT_SECRET` / `_CUSTOMER_ID` into `.env.local`.
3. Set `UBER_DIRECT_SANDBOX_TEST_MODE="1"` — every delivery request attaches the
   robo-courier test spec, so sandbox deliveries auto-complete without a real
   driver.
4. Add a webhook in the dashboard → `https://<tunnel>/api/webhooks/uber-direct`,
   copy its signing key into `UBER_DIRECT_WEBHOOK_SIGNING_KEY`.

> **Account activation gotcha:** a brand-new Uber Direct account authenticates
> fine (`getAccessToken` succeeds) but returns `400 invalid_params` —
> `param_details: "This account has been disabled. Please reach out to
> directbilling-group@uber.com to resolve"` — on every quote/create until Uber
> enables billing. `test-connection` will still show green (it only probes
> OAuth). Sort this with Uber before expecting quotes.

## DoorDash Drive

1. Create a Drive project at <https://developer.doordash.com>, request sandbox
   access, and set up a sandbox **business + store**.
2. Copy `DOORDASH_DEVELOPER_ID` / `_KEY_ID` / `_SIGNING_SECRET`.
3. Set `DOORDASH_SANDBOX="1"`.
4. Configure the webhook → `https://<tunnel>/api/webhooks/doordash`, set
   `DOORDASH_WEBHOOK_SECRET` (HMAC) — or the Basic-Auth pair.
5. Use DoorDash's **delivery simulator** to advance a sandbox delivery through
   its statuses and fire webhook events.

## Local tunneling

Both providers need a public HTTPS URL for webhooks. Use `cloudflared tunnel`
or `ngrok` against `localhost:3000` while running `pnpm dev`.

## Production safety

- Never point production `.env` at sandbox credentials or vice versa.
- The automated test suite never calls a real provider — all `fetch` calls are
  mocked.
- `test-connection` and `createQuote` never create a delivery; only
  `createFulfillment` (via the cron or the seller's explicit "Request delivery")
  does.
