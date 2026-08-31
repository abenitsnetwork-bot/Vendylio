/**
 * Prompt #12 — Delivery & Fulfillment Engine: shared vocabulary.
 *
 * The rest of Vendylio (checkout, orders, tracking, dashboard) only ever
 * speaks these normalized types. Provider-specific shapes stay inside
 * `providers/*` and never leak past `service.ts`.
 */
import 'server-only';

/** The four fulfillment providers Vendylio ships. `MERCHANT` = the seller is
 *  their own courier (the historical `self_manual`); `PICKUP` = no courier at
 *  all, the buyer collects in person. A future courier (Lyft, Roadie) is a new
 *  entry here + a new adapter + a `registry.ts` case — nothing else. */
export const PROVIDER_TYPES = ['UBER_DIRECT', 'DOORDASH', 'MERCHANT', 'PICKUP'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

/** Courier providers that talk to an external API (quote / dispatch / webhook). */
export const COURIER_PROVIDER_TYPES = ['UBER_DIRECT', 'DOORDASH'] as const;
export type CourierProviderType = (typeof COURIER_PROVIDER_TYPES)[number];

export function isCourierProvider(t: ProviderType): t is CourierProviderType {
  return t === 'UBER_DIRECT' || t === 'DOORDASH';
}

/** Buyer's checkout choice. Mirrors `Order.fulfillmentMethod` (PICKUP|DELIVERY). */
export type FulfillmentMethod = 'PICKUP' | 'DELIVERY';

/** Friendly, customer-safe provider names — never expose the raw enum. */
export const PROVIDER_FRIENDLY_NAME: Record<ProviderType, string> = {
  UBER_DIRECT: 'Uber',
  DOORDASH: 'DoorDash',
  MERCHANT: 'Merchant delivery',
  PICKUP: 'Pickup',
};

/**
 * Normalized fulfillment lifecycle. `Delivery.state` is always one of these
 * (except `UNKNOWN`, which is a sentinel — see stateMachine.ts).
 *
 *   PENDING → QUOTED → REQUESTED → CONFIRMED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
 *   (terminal: CANCELLED, FAILED)
 */
export const NORMALIZED_STATES = [
  'PENDING',
  'QUOTED',
  'REQUESTED',
  'CONFIRMED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
] as const;
export type NormalizedState = (typeof NORMALIZED_STATES)[number];

/** Returned by a provider adapter's `normalizeStatus` when the provider sent
 *  a status string we don't recognise — recorded + logged, never stored. */
export type ProviderStateOrUnknown = NormalizedState | 'UNKNOWN';

/** Who caused a state change — recorded on every `DeliveryEvent`. */
export type FulfillmentActor = 'SYSTEM' | 'MERCHANT' | 'PROVIDER' | 'CRON';

// ── Quote ────────────────────────────────────────────────────────────────

export interface DeliveryQuoteInput {
  /** Store's own pickup origin. */
  pickupAddress: string | null;
  pickupPhone: string | null;
  /** Buyer's destination — the raw {street,city,state,zip} checkout blob. */
  dropoffAddress: Record<string, unknown> | null;
  dropoffPhone: string | null;
  /** Cart subtotal in cents — some providers size the fee/insurance on it. */
  subtotalCents: number;
  currency: string;
}

export interface DeliveryQuote {
  provider: ProviderType;
  serviceable: boolean;
  /** Customer-facing fee, integer cents. Meaningful only when serviceable. */
  feeCents: number;
  currency: string;
  /** What the provider bills the platform — modeled for a future Vendylio
   *  margin, NOT applied to the customer price in V1. */
  providerCostCents?: number;
  estimatedPickupAt?: Date;
  estimatedDropoffAt?: Date;
  /** When this quote stops being valid for creating a delivery. */
  expiresAt?: Date;
  /** The provider's own quote id, needed to accept/create against it. */
  providerQuoteId?: string;
  /** Present when `serviceable === false` — a short reason for logs/UX. */
  unserviceableReason?: string;
}

// ── Create / snapshot ────────────────────────────────────────────────────

export interface CreateDeliveryInput {
  /** Vendylio-controlled stable id sent to the provider ("vend_<deliveryId>"). */
  externalDeliveryId: string;
  orderId: string;
  storeId: string;
  storeName: string;
  pickupAddress: string | null;
  pickupPhone: string | null;
  customerName: string | null;
  customerPhone: string | null;
  dropoffAddress: Record<string, unknown> | null;
  subtotalCents: number;
  currency: string;
  manifestItems: { name: string; quantity: number }[];
  /** A fresh provider quote id to create against, when the flow has one. */
  providerQuoteId?: string;
}

export interface CreateDeliveryResult {
  /** The provider's delivery id (may equal our externalDeliveryId for DoorDash). */
  providerDeliveryId: string | null;
  state: NormalizedState;
  trackingUrl?: string;
  estimatedPickupAt?: Date;
  estimatedDropoffAt?: Date;
  feeCents?: number;
  providerCostCents?: number;
  /** True when the provider reported this externalDeliveryId already exists
   *  and we hydrated from a GET rather than creating a second delivery. */
  deduplicated?: boolean;
}

/** A read of the provider's current view of a delivery (webhook or poll). */
export interface ProviderSnapshot {
  providerDeliveryId: string | null;
  /** Raw provider status string, for the event log. */
  rawStatus: string;
  state: ProviderStateOrUnknown;
  trackingUrl?: string;
  estimatedPickupAt?: Date;
  estimatedDropoffAt?: Date;
  pickedUpAt?: Date;
  deliveredAt?: Date;
  courierName?: string;
  courierPhone?: string;
  cancelReason?: string;
}

export interface CancelDeliveryResult {
  cancelled: boolean;
  reason?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  detail: string;
}
