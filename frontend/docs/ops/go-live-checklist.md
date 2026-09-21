# Stripe go-live checklist

Switching from Stripe test mode to live mode. Nothing in the code branches on
test vs. live — Stripe reads the mode off the key prefix (`sk_test_` /
`sk_live_`) itself, so this is entirely a **credentials + dashboard
configuration** exercise, done in Vercel's **Production** environment. No
code change, no deploy of new code required (a redeploy is still needed
afterward so the app picks up the new env vars).

There are **3 separate Stripe webhook endpoints** in this app, each with its
own signing secret — recreate all three in live mode, don't reuse the test
ones.

## 1. Get live API keys

Stripe dashboard → toggle out of "Test mode" → **Developers → API keys**:

| Var | Stripe dashboard field |
|---|---|
| `STRIPE_SECRET_KEY` | Secret key (`sk_live_...`) |
| `STRIPE_PUBLISHABLE_KEY` | Publishable key (`pk_live_...`) |

## 2. Recreate the 3 webhook endpoints (live mode)

Still in live mode, **Developers → Webhooks → Add endpoint**, once per row.
Each gives you a distinct `whsec_...` signing secret — copy it into the
matching env var.

| Endpoint URL | Events to subscribe | Env var for the signing secret |
|---|---|---|
| `https://vendylio.com/api/webhooks/stripe` | `checkout.session.completed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` | `STRIPE_WEBHOOK_SECRET` |
| `https://vendylio.com/api/webhooks/stripe-connect` | `account.updated`, `transfer.reversed` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| `https://vendylio.com/api/webhooks/stripe-billing` | `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `checkout.session.completed` | `STRIPE_BILLING_WEBHOOK_SECRET` |

**`charge.refunded` matters even if you never touch Stripe's dashboard
directly** — without it, a refund issued from inside the Stripe dashboard
itself (rather than through Vendylio's own "Refund" button) won't update the
order. Don't skip it on the first endpoint.

## 3. Recreate the Pro subscription price(s) — live mode

Stripe Prices are **not shared between test and live** — the price IDs you
used in test mode do not exist in live mode. In live mode, **Products →
Vendylio Pro** (or create it), add:

- A monthly recurring price → `STRIPE_PRO_PRICE_ID`
- (Optional) An annual recurring price on the *same* product →
  `STRIPE_PRO_ANNUAL_PRICE_ID` (omit it and the billing page's annual toggle
  silently falls back to the monthly price for both)

## 4. Stripe Connect

If any seller has gone through "Connect your bank" onboarding, that was in
**test mode** — those connected accounts do not carry over to live mode.
Once live, sellers with `stripeOnboardingStatus=ACTIVE` from testing will
need to redo onboarding for real before Connect destination charges /
BANK payouts work for them. Card checkout still works in the meantime via
the platform-charge fallback.

## 5. Set the env vars in Vercel (Production environment) and redeploy

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...        (endpoint 1)
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...  (endpoint 2)
STRIPE_BILLING_WEBHOOK_SECRET=whsec_...  (endpoint 3)
STRIPE_PRO_PRICE_ID=price_...
STRIPE_PRO_ANNUAL_PRICE_ID=price_...   (if offering annual)
```

A Vercel env var change does not apply to an already-running deployment —
trigger a redeploy (or push any commit) after saving these.

## 6. Verify

- [ ] Place one small real order end-to-end (real card, real charge) — confirm
      it lands `PAID` in `/dashboard/orders` and `/admin`.
- [ ] Stripe dashboard → each of the 3 webhook endpoints shows recent
      deliveries as `200`, not failing/retrying.
- [ ] `GET /api/billing/status` / the "Upgrade to Pro" button works if Pro
      billing is being launched at the same time.
- [ ] Refund that same test order from the Vendylio dashboard — confirm it
      flips to `REFUNDED`.
- [ ] Check Sentry (if configured) for any new errors in the minutes after
      cutover.

## Reference

See `CLAUDE.md`'s "Payments — Stripe + Stripe Connect" and "Plans & billing"
sections for what each of these three webhooks actually drives in code.
