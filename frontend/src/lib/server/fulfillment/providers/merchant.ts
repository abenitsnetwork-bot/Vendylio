/**
 * MERCHANT delivery "provider" — the seller is their own courier (the
 * historical `self_manual`). No external API: `quote` reads the store's
 * configured flat fee + minimum-order gate, `createDelivery` is a no-op, and
 * completion happens when the seller clicks "Mark delivered".
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

const DEFAULT_CONFIG: MethodConfigMerchant = {
  enabled: true,
  feeCents: 0,
  minOrderCents: 0,
  instructions: null,
};

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
        return {
          provider: 'MERCHANT',
          serviceable: false,
          feeCents: config.feeCents,
          currency: input.currency,
          unserviceableReason: `Minimum order for delivery is ${(config.minOrderCents / 100).toFixed(2)}.`,
        };
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
