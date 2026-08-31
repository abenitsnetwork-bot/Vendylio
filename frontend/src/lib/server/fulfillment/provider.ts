/**
 * Prompt #12 — the provider-agnostic delivery interface (v2).
 *
 * Supersedes the Phase-5 `lib/server/delivery/provider.ts` `DeliveryProvider`
 * (which is kept, and re-implemented over the registry). Routes + the
 * fulfillment service consume THIS interface — never a concrete adapter — so
 * a new courier is one `providers/*` file + one `registry.ts` case.
 *
 * Capability model: `quote` / `createDelivery` / `getDelivery` /
 * `cancelDelivery` are always present, but MERCHANT and PICKUP implement them
 * as no-ops / config reads (they have no external API). `supports*` flags let
 * a caller branch without a provider `switch`.
 */
import 'server-only';
import type {
  CancelDeliveryResult,
  CreateDeliveryInput,
  CreateDeliveryResult,
  DeliveryQuote,
  DeliveryQuoteInput,
  ProviderSnapshot,
  ProviderStateOrUnknown,
  ProviderType,
  TestConnectionResult,
} from './types';

export interface DeliveryProviderCapabilities {
  /** Talks to an external courier API (quote, dispatch, webhook, poll). */
  external: boolean;
  quotes: boolean;
  cancellation: boolean;
  webhooks: boolean;
  /** Provider returns a customer-facing tracking URL. */
  tracking: boolean;
}

export interface FulfillmentProvider {
  readonly type: ProviderType;
  readonly friendlyName: string;
  readonly capabilities: DeliveryProviderCapabilities;

  /** True when the platform-level credentials for this provider are set. Always
   *  true for MERCHANT / PICKUP. */
  isConfigured(): boolean;

  /** Get a fee + serviceability + ETA. MUST NOT throw — any failure resolves
   *  to `{ serviceable: false, unserviceableReason }`. */
  quote(input: DeliveryQuoteInput): Promise<DeliveryQuote>;

  /** Create the external delivery. Idempotent on `input.externalDeliveryId`:
   *  a provider "already exists" conflict resolves to a GET-hydrated result
   *  with `deduplicated: true`, never a second dispatch. MERCHANT / PICKUP
   *  return `{ providerDeliveryId: null, state: 'REQUESTED' }` without a call. */
  createDelivery(input: CreateDeliveryInput): Promise<CreateDeliveryResult>;

  /** Current provider view of a delivery (used by the poll cron + retry
   *  reconciliation). MERCHANT / PICKUP: echoes nothing useful. */
  getDelivery(externalDeliveryId: string): Promise<ProviderSnapshot>;

  /** Ask the provider to cancel. `{ cancelled: false, reason }` when the
   *  provider refuses (courier already assigned, etc.). */
  cancelDelivery(externalDeliveryId: string): Promise<CancelDeliveryResult>;

  /** Map one raw provider status string to a normalized state. Unknown →
   *  `'UNKNOWN'` (caller records + logs, does not move state). */
  normalizeStatus(providerStatus: string): ProviderStateOrUnknown;

  /** A safe credential probe. MUST NEVER dispatch a real driver. */
  testConnection(): Promise<TestConnectionResult>;
}
