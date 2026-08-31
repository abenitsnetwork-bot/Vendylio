/**
 * DOORDASH (DoorDash Drive) adapter.
 *
 * Phase 1 ships this as an inert stub: `isConfigured()` is false, `quote`
 * always returns `serviceable: false`, and dispatch is a hard error. Phase 3
 * replaces the body with the real Drive integration (JWT auth, quote → accept
 * workflow, `external_delivery_id`, duplicate-conflict handling, webhook).
 * Keeping the file here now lets `registry.ts` list all four providers
 * uniformly from day one.
 */
import 'server-only';
import type { FulfillmentProvider } from '../provider';
import type {
  CancelDeliveryResult,
  CreateDeliveryInput,
  CreateDeliveryResult,
  DeliveryQuote,
  DeliveryQuoteInput,
  ProviderSnapshot,
  ProviderStateOrUnknown,
} from '../types';

export function isDoorDashConfigured(): boolean {
  return Boolean(
    process.env.DOORDASH_DEVELOPER_ID &&
    process.env.DOORDASH_KEY_ID &&
    process.env.DOORDASH_SIGNING_SECRET,
  );
}

/** DoorDash Drive delivery status → normalized state. Wired in Phase 1 so the
 *  mapping table can be tested; the transport around it lands in Phase 3. */
export function normalizeDoorDashStatus(raw: string): ProviderStateOrUnknown {
  switch (raw.toLowerCase()) {
    case 'created':
    case 'quote_accepted':
      return 'REQUESTED';
    case 'dasher_confirmed':
    case 'arrived_at_pickup':
      return 'CONFIRMED';
    case 'picked_up':
    case 'dasher_confirmed_pickup':
      return 'PICKED_UP';
    case 'en_route_to_dropoff':
    case 'arrived_at_dropoff':
      return 'OUT_FOR_DELIVERY';
    case 'delivered':
      return 'DELIVERED';
    case 'cancelled':
    case 'canceled':
      return 'CANCELLED';
    case 'delivery_attempt_failed':
    case 'returned':
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
}

export function createDoorDashFulfillmentProvider(): FulfillmentProvider {
  return {
    type: 'DOORDASH',
    friendlyName: 'DoorDash',
    capabilities: {
      external: true,
      quotes: true,
      cancellation: true,
      webhooks: true,
      tracking: true,
    },
    isConfigured: isDoorDashConfigured,

    async quote(input: DeliveryQuoteInput): Promise<DeliveryQuote> {
      return {
        provider: 'DOORDASH',
        serviceable: false,
        feeCents: 0,
        currency: input.currency,
        unserviceableReason: 'DoorDash Drive is not wired yet (Phase 3).',
      };
    },

    async createDelivery(_input: CreateDeliveryInput): Promise<CreateDeliveryResult> {
      throw new Error('DoorDash Drive dispatch is not wired yet (Phase 3).');
    },

    async getDelivery(_externalDeliveryId: string): Promise<ProviderSnapshot> {
      return { providerDeliveryId: null, rawStatus: 'unknown', state: 'UNKNOWN' };
    },

    async cancelDelivery(_externalDeliveryId: string): Promise<CancelDeliveryResult> {
      return { cancelled: false, reason: 'DoorDash Drive is not wired yet (Phase 3).' };
    },

    normalizeStatus: normalizeDoorDashStatus,

    async testConnection() {
      return { ok: false, detail: 'DoorDash Drive is not wired yet (Phase 3).' };
    },
  };
}
