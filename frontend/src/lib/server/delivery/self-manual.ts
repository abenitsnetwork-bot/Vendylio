/**
 * Self/Manual delivery provider — Phase 5's first real implementation. The
 * seller is their own courier: "requesting" delivery is just a bookkeeping
 * step (no external dispatch call), and "delivered" is whatever the seller
 * says it is (no external confirmation to wait for). No configuration, no
 * credentials — this is why it's the default for every Store.
 */
import 'server-only';
import type { DeliveryProvider, DeliveryRequestInput, DeliveryRequestResult } from './provider';

export function createSelfManualProvider(): DeliveryProvider {
  return {
    name: 'self_manual',

    async requestDelivery(_input: DeliveryRequestInput): Promise<DeliveryRequestResult> {
      return {
        providerDeliveryId: null,
        status: 'REQUESTED',
      };
    },

    async markDelivered(): Promise<{ status: 'DELIVERED' }> {
      return { status: 'DELIVERED' };
    },
  };
}
