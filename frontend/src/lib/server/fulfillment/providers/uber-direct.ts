/**
 * UBER_DIRECT adapter for the Prompt #12 engine — a thin v2 wrapper over the
 * Phase-5 `lib/server/delivery/uber-direct.ts` (the real `uber-direct` SDK
 * integration). This file only adapts shapes; the SDK calls, auth token
 * cache and typed errors stay in the delivery/ module.
 *
 * Phase 1 wires `quote` + `createDelivery` + `normalizeStatus` +
 * `testConnection`. `getDelivery` / `cancelDelivery` are stubbed here and
 * filled in Phase 3 (poll cron + cancel route) once the SDK's
 * get/cancel endpoints are ground-truthed.
 */
import 'server-only';
import {
  createUberDirectProvider as createLegacyUberProvider,
  getUberDirectDeliveryFeeCents,
  isUberDirectConfigured,
  uberDirectAuthProbe,
} from '@/lib/server/delivery/uber-direct';
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

/** Uber Direct DaaS delivery status → normalized state.
 *  (github.com/uber/uber-direct-sdk + live sandbox verification.) */
export function normalizeUberStatus(raw: string): ProviderStateOrUnknown {
  switch (raw.toLowerCase()) {
    case 'pending':
      return 'REQUESTED';
    case 'pickup':
      return 'CONFIRMED';
    case 'pickup_complete':
      return 'PICKED_UP';
    case 'dropoff':
      return 'OUT_FOR_DELIVERY';
    case 'delivered':
      return 'DELIVERED';
    case 'canceled':
    case 'cancelled':
      return 'CANCELLED';
    case 'returned':
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
}

export function createUberDirectFulfillmentProvider(): FulfillmentProvider {
  return {
    type: 'UBER_DIRECT',
    friendlyName: 'Uber',
    capabilities: {
      external: true,
      quotes: true,
      cancellation: true,
      webhooks: true,
      tracking: true,
    },
    isConfigured: isUberDirectConfigured,

    async quote(input: DeliveryQuoteInput): Promise<DeliveryQuote> {
      if (!isUberDirectConfigured()) {
        return {
          provider: 'UBER_DIRECT',
          serviceable: false,
          feeCents: 0,
          currency: input.currency,
          unserviceableReason: 'Uber Direct is not configured.',
        };
      }
      const feeCents = await getUberDirectDeliveryFeeCents({
        pickupAddress: input.pickupAddress,
        deliveryAddress: input.dropoffAddress,
        amountCents: input.subtotalCents,
      });
      if (feeCents === null) {
        return {
          provider: 'UBER_DIRECT',
          serviceable: false,
          feeCents: 0,
          currency: input.currency,
          unserviceableReason: 'Uber Direct could not quote this address.',
        };
      }
      return {
        provider: 'UBER_DIRECT',
        serviceable: true,
        feeCents,
        currency: input.currency,
        // Uber quotes are short-lived; the engine re-quotes at payment anyway.
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      };
    },

    async createDelivery(input: CreateDeliveryInput): Promise<CreateDeliveryResult> {
      const legacy = createLegacyUberProvider();
      const result = await legacy.requestDelivery({
        orderId: input.orderId,
        storeId: input.storeId,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        deliveryAddress: input.dropoffAddress,
        pickupAddress: input.pickupAddress,
        storeName: input.storeName,
        storePhone: input.pickupPhone,
        amountCents: input.subtotalCents,
        manifestItems: input.manifestItems,
      });
      return {
        providerDeliveryId: result.providerDeliveryId,
        state: 'REQUESTED',
        ...(result.trackingUrl ? { trackingUrl: result.trackingUrl } : {}),
      };
    },

    async getDelivery(_externalDeliveryId: string): Promise<ProviderSnapshot> {
      // Phase 3 — GET /v1/customers/{id}/deliveries/{id}. Until then the poll
      // cron simply skips Uber deliveries and relies on the webhook.
      return { providerDeliveryId: null, rawStatus: 'unknown', state: 'UNKNOWN' };
    },

    async cancelDelivery(_externalDeliveryId: string): Promise<CancelDeliveryResult> {
      // Phase 3 — POST /v1/customers/{id}/deliveries/{id}/cancel.
      return { cancelled: false, reason: 'Uber Direct cancellation is not wired yet.' };
    },

    normalizeStatus: normalizeUberStatus,

    testConnection: uberDirectAuthProbe,
  };
}
