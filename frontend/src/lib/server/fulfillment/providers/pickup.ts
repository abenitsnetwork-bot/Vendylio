/**
 * PICKUP "provider" — there is no courier and no external API. The buyer
 * collects the order in person; the seller marks it handed over via the
 * generic order status flow. Implemented as a `FulfillmentProvider` purely so
 * the rest of the engine treats every method uniformly (no provider `switch`).
 */
import 'server-only';
import type { FulfillmentProvider } from '../provider';
import type { MethodConfigPickup } from '../config';
import type {
  CreateDeliveryInput,
  CreateDeliveryResult,
  DeliveryQuote,
  DeliveryQuoteInput,
  ProviderSnapshot,
  ProviderStateOrUnknown,
} from '../types';

export function createPickupProvider(config?: MethodConfigPickup): FulfillmentProvider {
  void config;
  return {
    type: 'PICKUP',
    friendlyName: 'Pickup',
    capabilities: {
      external: false,
      quotes: false,
      cancellation: true,
      webhooks: false,
      tracking: false,
    },
    isConfigured: () => true,

    async quote(_input: DeliveryQuoteInput): Promise<DeliveryQuote> {
      return { provider: 'PICKUP', serviceable: true, feeCents: 0, currency: 'USD' };
    },

    async createDelivery(_input: CreateDeliveryInput): Promise<CreateDeliveryResult> {
      return { providerDeliveryId: null, state: 'REQUESTED' };
    },

    async getDelivery(_externalDeliveryId: string): Promise<ProviderSnapshot> {
      return { providerDeliveryId: null, rawStatus: 'pickup', state: 'REQUESTED' };
    },

    async cancelDelivery() {
      return { cancelled: true };
    },

    normalizeStatus(_providerStatus: string): ProviderStateOrUnknown {
      return 'REQUESTED';
    },

    async testConnection() {
      return { ok: true, detail: 'Pickup needs no connection.' };
    },
  };
}
