/**
 * Prompt #12 — `Store.fulfillmentConfig` normalization.
 *
 * The column is a free JSON blob (so new method options don't need a
 * migration). `readFulfillmentConfig(store)` turns whatever is there — `{}`,
 * a partial object, or a fully-populated one — into a strict shape, filling
 * gaps from the legacy `deliveryProvider` / `deliveryFeeCents` columns so a
 * store that predates the engine behaves exactly as before.
 */
import 'server-only';
import { PROVIDER_TYPES, type ProviderType } from './types';

export interface MethodConfigPickup {
  enabled: boolean;
  instructions: string | null;
}
export interface MethodConfigMileage {
  /** Flat starting fee, added on top of the per-mile charge. */
  baseFeeCents: number;
  /** Charged per straight-line mile between the store and the dropoff
   *  address (haversine — see lib/server/geocoding/distance.ts). */
  perMileCents: number;
  /** Beyond this radius the quote is unserviceable. null = no cap. */
  maxMiles: number | null;
}
export interface MethodConfigMerchant {
  enabled: boolean;
  /** Used when pricingMode === 'FLAT'. */
  feeCents: number;
  minOrderCents: number;
  instructions: string | null;
  pricingMode: 'FLAT' | 'MILEAGE';
  /** Used when pricingMode === 'MILEAGE'. */
  mileage: MethodConfigMileage;
}
export interface MethodConfigCourier {
  enabled: boolean;
}

export interface FulfillmentConfig {
  pickup: MethodConfigPickup;
  merchant: MethodConfigMerchant;
  uberDirect: MethodConfigCourier;
  doordash: MethodConfigCourier;
  /** When true AND >1 serviceable delivery method exists, checkout shows a
   *  provider picker; otherwise the cheapest serviceable quote is used. */
  customerChoosesProvider: boolean;
}

/** The columns `readFulfillmentConfig` needs — a subset of `Store`. */
export interface StoreFulfillmentInput {
  fulfillmentConfig: unknown;
  deliveryProvider: string;
  deliveryFeeCents: number;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function intCents(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function pricingMode(v: unknown): 'FLAT' | 'MILEAGE' {
  return v === 'MILEAGE' ? 'MILEAGE' : 'FLAT';
}
function nullableNonNegative(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export function readFulfillmentConfig(store: StoreFulfillmentInput): FulfillmentConfig {
  const cfg = asRecord(store.fulfillmentConfig);
  const pickup = asRecord(cfg.pickup);
  const merchant = asRecord(cfg.merchant);
  const mileage = asRecord(merchant.mileage);
  const uber = asRecord(cfg.uberDirect);
  const dd = asRecord(cfg.doordash);

  const legacyIsUber = store.deliveryProvider === 'uber_direct';

  return {
    pickup: {
      enabled: bool(pickup.enabled, true),
      instructions: str(pickup.instructions),
    },
    merchant: {
      enabled: bool(merchant.enabled, !legacyIsUber),
      feeCents: intCents(merchant.feeCents, store.deliveryFeeCents),
      minOrderCents: intCents(merchant.minOrderCents, 0),
      instructions: str(merchant.instructions),
      pricingMode: pricingMode(merchant.pricingMode),
      mileage: {
        baseFeeCents: intCents(mileage.baseFeeCents, 0),
        perMileCents: intCents(mileage.perMileCents, 0),
        maxMiles: nullableNonNegative(mileage.maxMiles),
      },
    },
    uberDirect: { enabled: bool(uber.enabled, legacyIsUber) },
    doordash: { enabled: bool(dd.enabled, false) },
    customerChoosesProvider: bool(cfg.customerChoosesProvider, false),
  };
}

/** Which provider types the merchant has switched ON (regardless of whether
 *  the platform credentials for them are actually set). */
export function enabledProviderTypes(cfg: FulfillmentConfig): ProviderType[] {
  const out: ProviderType[] = [];
  if (cfg.uberDirect.enabled) out.push('UBER_DIRECT');
  if (cfg.doordash.enabled) out.push('DOORDASH');
  if (cfg.merchant.enabled) out.push('MERCHANT');
  if (cfg.pickup.enabled) out.push('PICKUP');
  return out;
}

/**
 * The provider that should fulfill one delivery order. `explicit` is the
 * buyer's checkout pick (`Order.deliveryProviderType` / the request body's
 * `deliveryProviderType`).
 *
 * Prompt #13 (R2): an explicit pick is honored ONLY when that provider is
 * actually switched on in `Store.fulfillmentConfig`. A crafted request naming
 * a provider the merchant never enabled falls through to the config default
 * instead of routing a real courier bill through it. When `explicit` is null
 * (a pre-Phase-4 order, or a store with no courier chosen) the same fallback
 * applies: a courier if the config points at one, else MERCHANT.
 */
export function resolveOrderProviderType(
  explicit: string | null,
  cfg: FulfillmentConfig,
): ProviderType {
  if (
    explicit &&
    (PROVIDER_TYPES as readonly string[]).includes(explicit) &&
    enabledProviderTypes(cfg).includes(explicit as ProviderType)
  ) {
    return explicit as ProviderType;
  }
  if (cfg.uberDirect.enabled) return 'UBER_DIRECT';
  if (cfg.doordash.enabled) return 'DOORDASH';
  return 'MERCHANT';
}

/** Serialize back to the JSON column (used by the settings PATCH route). */
export function serializeFulfillmentConfig(cfg: FulfillmentConfig): Record<string, unknown> {
  return {
    pickup: { enabled: cfg.pickup.enabled, instructions: cfg.pickup.instructions },
    merchant: {
      enabled: cfg.merchant.enabled,
      feeCents: cfg.merchant.feeCents,
      minOrderCents: cfg.merchant.minOrderCents,
      instructions: cfg.merchant.instructions,
      pricingMode: cfg.merchant.pricingMode,
      mileage: {
        baseFeeCents: cfg.merchant.mileage.baseFeeCents,
        perMileCents: cfg.merchant.mileage.perMileCents,
        maxMiles: cfg.merchant.mileage.maxMiles,
      },
    },
    uberDirect: { enabled: cfg.uberDirect.enabled },
    doordash: { enabled: cfg.doordash.enabled },
    customerChoosesProvider: cfg.customerChoosesProvider,
  };
}
