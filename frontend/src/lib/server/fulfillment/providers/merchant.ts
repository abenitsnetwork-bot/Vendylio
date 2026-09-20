/**
 * MERCHANT delivery "provider" — the seller is their own courier (the
 * historical `self_manual`). No external API for delivery itself:
 * `createDelivery` is a no-op and completion happens when the seller clicks
 * "Mark delivered". `quote` supports two pricing modes:
 *  - FLAT (default): the store's configured flat fee + minimum-order gate.
 *  - MILEAGE: a base fee + a per-mile charge, computed from the straight-line
 *    (haversine) distance between the store's geocoded pickup address and
 *    the buyer's dropoff address — see lib/server/geocoding/.
 */
import 'server-only';
import type { FulfillmentProvider } from '../provider';
import type { MethodConfigMerchant } from '../config';
import type {
  CreateDeliveryInput,
  CreateDeliveryResult,
  DeliveryQuote,
  DeliveryQuoteInput,
  ProviderSnapshot,
  ProviderStateOrUnknown,
} from '../types';
import { geocodeAddress, GeocodingNotConfiguredError } from '@/lib/server/geocoding/google';
import { haversineMiles } from '@/lib/server/geocoding/distance';

const DEFAULT_CONFIG: MethodConfigMerchant = {
  enabled: true,
  feeCents: 0,
  minOrderCents: 0,
  instructions: null,
  pricingMode: 'FLAT',
  mileage: { baseFeeCents: 0, perMileCents: 0, maxMiles: null },
};

function unserviceable(currency: string, reason: string): DeliveryQuote {
  return {
    provider: 'MERCHANT',
    serviceable: false,
    feeCents: 0,
    currency,
    unserviceableReason: reason,
  };
}

/** Turns the checkout's free-text {street,city,state,zip} blob into a single
 *  geocodable string. Returns null when there's nothing usable in it. */
function addressToString(addr: Record<string, unknown> | null): string | null {
  if (!addr) return null;
  const get = (k: string) => (typeof addr[k] === 'string' ? (addr[k] as string).trim() : '');
  const [street, city, state, zip] = ['street', 'city', 'state', 'zip'].map(get);
  const line2 = [city, state].filter(Boolean).join(', ');
  const parts = [street, line2, zip].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

async function quoteMileage(
  config: MethodConfigMerchant,
  input: DeliveryQuoteInput,
): Promise<DeliveryQuote> {
  if (input.pickupLat == null || input.pickupLng == null) {
    return unserviceable(
      input.currency,
      'Delivery pricing isn’t set up yet — save your store address in Settings.',
    );
  }

  const dropoffStr = addressToString(input.dropoffAddress);
  if (!dropoffStr) {
    return unserviceable(input.currency, 'Enter a delivery address to see the fee.');
  }

  let dest: { lat: number; lng: number } | null;
  try {
    dest = await geocodeAddress(dropoffStr);
  } catch (err) {
    if (err instanceof GeocodingNotConfiguredError) {
      return unserviceable(
        input.currency,
        'Distance-based delivery pricing is not available right now.',
      );
    }
    throw err;
  }
  if (!dest) {
    return unserviceable(input.currency, "We couldn't find that address — check it and try again.");
  }

  const miles = haversineMiles({ lat: input.pickupLat, lng: input.pickupLng }, dest);
  if (config.mileage.maxMiles != null && miles > config.mileage.maxMiles) {
    return unserviceable(
      input.currency,
      `That address is outside our ${config.mileage.maxMiles}-mile delivery radius.`,
    );
  }

  const feeCents = Math.round(config.mileage.baseFeeCents + config.mileage.perMileCents * miles);
  return { provider: 'MERCHANT', serviceable: true, feeCents, currency: input.currency };
}

export function createMerchantProvider(
  config: MethodConfigMerchant = DEFAULT_CONFIG,
): FulfillmentProvider {
  return {
    type: 'MERCHANT',
    friendlyName: 'Merchant delivery',
    capabilities: {
      external: false,
      quotes: true,
      cancellation: true,
      webhooks: false,
      tracking: false,
    },
    isConfigured: () => true,

    async quote(input: DeliveryQuoteInput): Promise<DeliveryQuote> {
      if (config.minOrderCents > 0 && input.subtotalCents < config.minOrderCents) {
        return unserviceable(
          input.currency,
          `Minimum order for delivery is ${(config.minOrderCents / 100).toFixed(2)}.`,
        );
      }
      if (config.pricingMode === 'MILEAGE') {
        return quoteMileage(config, input);
      }
      return {
        provider: 'MERCHANT',
        serviceable: true,
        feeCents: config.feeCents,
        currency: input.currency,
      };
    },

    async createDelivery(_input: CreateDeliveryInput): Promise<CreateDeliveryResult> {
      return { providerDeliveryId: null, state: 'REQUESTED' };
    },

    async getDelivery(_externalDeliveryId: string): Promise<ProviderSnapshot> {
      return { providerDeliveryId: null, rawStatus: 'merchant', state: 'REQUESTED' };
    },

    async cancelDelivery() {
      return { cancelled: true };
    },

    normalizeStatus(_providerStatus: string): ProviderStateOrUnknown {
      return 'REQUESTED';
    },

    async testConnection() {
      return { ok: true, detail: 'Merchant delivery needs no connection.' };
    },
  };
}
