/**
 * Uber Direct — real courier integration via the official `uber-direct` npm
 * SDK (v0.1.8). Ground-truthed against the SDK's own compiled source AND
 * against the real API (live-tested against an actual Uber Direct sandbox
 * account) rather than trusted blindly, because its docs don't hold up:
 *   - Its published TypeScript types are broken (`dist/src/types/` — an
 *     OpenAPI-generated directory the `.d.ts` files import from — is missing
 *     from the npm package), so this file defines its own request/response
 *     shapes instead of importing the SDK's.
 *   - Its README mixes camelCase into `createQuote`'s example while
 *     `createDelivery`'s example is snake_case — this looked like a doc bug
 *     but ISN'T: confirmed against Uber's own first-party `uber-direct-sdk`
 *     (github.com/uber/uber-direct-sdk) and live-verified against the real
 *     API that `createDelivery`'s body is snake_case throughout EXCEPT
 *     `testSpecifications.roboCourierSpecification.mode`, which must stay
 *     camelCase — sending it as `test_specifications`/`robo_courier_specification`
 *     gets a 400 `invalid_params` with no field-level detail in the error.
 *     `createQuote`'s snake_case fields (`pickup_address`/`dropoff_address`)
 *     work fine live despite the SDK's own camelCase example.
 *
 * Auth: the SDK's `getAccessToken()` reads UBER_DIRECT_CLIENT_ID/SECRET from
 * env and hits https://login.uber.com/oauth/v2/token fresh every call — it
 * has no caching of its own. Uber Direct tokens are valid 30 days and token
 * requests are rate-limited to 100/hour, so this module caches the token
 * itself (module-level, single-instance — same documented limitation as
 * payments/circuit-breaker.ts) and refreshes well before real expiry.
 *
 * Completion is NOT seller-triggered: a real courier reports delivery via
 * its own webhook (see lib/server/webhook/uber-direct.ts), matching the
 * DeliveryProvider interface's own docstring — `markDelivered()` here throws
 * rather than pretending a manual click means anything.
 *
 * ⚠️ Residual ambiguity: Uber's public docs describe two similar-but-distinct
 * products ("Uber Direct" DaaS vs. "Uber Eats Orders") with different webhook
 * payload shapes. This file targets the DaaS schema, which matches the
 * installed SDK's endpoint namespace (`/v1/customers/{id}/deliveries`) — but
 * it has not been exercised against a real Uber Direct account. Verify
 * against your own Uber Direct dashboard's test webhooks once you have
 * credentials.
 */
import 'server-only';
import { getAccessToken, createDeliveriesClient } from 'uber-direct';
import type { DeliveryProvider, DeliveryRequestInput, DeliveryRequestResult } from './provider';

export class UberDirectNotConfiguredError extends Error {
  constructor() {
    super(
      'Uber Direct is not configured — set UBER_DIRECT_CLIENT_ID, UBER_DIRECT_CLIENT_SECRET, and UBER_DIRECT_CUSTOMER_ID.',
    );
    this.name = 'UberDirectNotConfiguredError';
  }
}

export class UberDirectMissingDetailsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UberDirectMissingDetailsError';
  }
}

export class UberDirectRequestFailedError extends Error {
  constructor(message: string) {
    super(`Uber Direct request failed: ${message}`);
    this.name = 'UberDirectRequestFailedError';
  }
}

export class UberDirectManualConfirmationNotSupportedError extends Error {
  constructor() {
    super(
      'Uber Direct deliveries complete automatically once the courier confirms drop-off — there is nothing to manually confirm here. Check the Uber Direct dashboard if a delivery looks stuck.',
    );
    this.name = 'UberDirectManualConfirmationNotSupportedError';
  }
}

function isConfigured(): boolean {
  return Boolean(
    process.env.UBER_DIRECT_CLIENT_ID &&
    process.env.UBER_DIRECT_CLIENT_SECRET &&
    process.env.UBER_DIRECT_CUSTOMER_ID,
  );
}

// Single-instance token cache — same documented limitation as
// payments/circuit-breaker.ts. Uber Direct tokens last 30 days; refreshed
// after 24h so a stale cache is never relied on for weeks.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getCachedAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token;
  const token = await getAccessToken();
  cachedToken = { token, expiresAt: now + 24 * 60 * 60 * 1000 };
  return token;
}

function formatDropoffAddress(addr: Record<string, unknown> | null): string | null {
  if (!addr) return null;
  const street = typeof addr.street === 'string' ? addr.street : null;
  const city = typeof addr.city === 'string' ? addr.city : null;
  const state = typeof addr.state === 'string' ? addr.state : null;
  const zip = typeof addr.zip === 'string' ? addr.zip : null;
  const line = [street, [city, state].filter(Boolean).join(', '), zip].filter(Boolean).join(', ');
  return line || null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface UberDeliveryQuoteResponse {
  id?: string;
}

interface UberDeliveryResponse {
  id?: string;
  tracking_url?: string;
}

export function createUberDirectProvider(): DeliveryProvider {
  return {
    name: 'uber_direct',

    async requestDelivery(input: DeliveryRequestInput): Promise<DeliveryRequestResult> {
      if (!isConfigured()) throw new UberDirectNotConfiguredError();

      if (!input.pickupAddress) {
        throw new UberDirectMissingDetailsError(
          'Set a pickup address for your store in Delivery settings before requesting an Uber Direct delivery.',
        );
      }
      if (!input.storePhone) {
        throw new UberDirectMissingDetailsError(
          'Set a store phone number in Settings before requesting an Uber Direct delivery — Uber requires a callable pickup contact.',
        );
      }
      const dropoffAddress = formatDropoffAddress(input.deliveryAddress);
      if (!dropoffAddress) {
        throw new UberDirectMissingDetailsError(
          'This order has no delivery address on file — Uber Direct cannot dispatch a courier without one.',
        );
      }
      if (!input.customerPhone) {
        throw new UberDirectMissingDetailsError(
          'This order has no customer phone number on file — Uber requires a callable drop-off contact.',
        );
      }

      const customerId = process.env.UBER_DIRECT_CUSTOMER_ID!;
      let token: string;
      try {
        token = await getCachedAccessToken();
      } catch (err) {
        throw new UberDirectRequestFailedError(
          `could not obtain an access token — ${errorMessage(err)}`,
        );
      }
      const client = createDeliveriesClient(token, customerId);

      let quote: UberDeliveryQuoteResponse;
      try {
        quote = (await client.createQuote({
          pickup_address: input.pickupAddress,
          dropoff_address: dropoffAddress,
          manifest_total_value: input.amountCents,
        })) as UberDeliveryQuoteResponse;
      } catch (err) {
        throw new UberDirectRequestFailedError(`quote request rejected — ${errorMessage(err)}`);
      }

      const sandbox = process.env.UBER_DIRECT_SANDBOX_TEST_MODE === '1';
      let delivery: UberDeliveryResponse;
      try {
        delivery = (await client.createDelivery({
          pickup_name: input.storeName,
          pickup_address: input.pickupAddress,
          pickup_phone_number: input.storePhone,
          dropoff_name: input.customerName ?? 'Customer',
          dropoff_address: dropoffAddress,
          dropoff_phone_number: input.customerPhone,
          manifest_total_value: input.amountCents,
          ...(input.manifestItems.length > 0
            ? { manifest_items: input.manifestItems.map((item) => ({ ...item, size: 'small' })) }
            : {}),
          ...(quote.id ? { quote_id: quote.id } : {}),
          external_id: input.orderId,
          // Deliberately camelCase — see the file header. Every other field
          // in this request is snake_case; this one isn't, confirmed live.
          ...(sandbox
            ? { testSpecifications: { roboCourierSpecification: { mode: 'auto' } } }
            : {}),
        })) as UberDeliveryResponse;
      } catch (err) {
        throw new UberDirectRequestFailedError(`delivery creation rejected — ${errorMessage(err)}`);
      }

      if (!delivery.id) {
        throw new UberDirectRequestFailedError('Uber Direct returned no delivery id.');
      }

      return {
        providerDeliveryId: delivery.id,
        status: 'REQUESTED',
        ...(delivery.tracking_url ? { trackingUrl: delivery.tracking_url } : {}),
      };
    },

    async markDelivered(): Promise<{ status: 'DELIVERED' }> {
      throw new UberDirectManualConfirmationNotSupportedError();
    },
  };
}
