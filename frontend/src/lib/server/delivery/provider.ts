/**
 * Provider-agnostic delivery interface — same spirit as `payments/provider.ts`.
 *
 * Each delivery provider (self-manual today, Uber Direct later) implements
 * `DeliveryProvider`. Routes consume the interface — never a concrete
 * adapter directly — so swapping/adding providers per Store is one wiring
 * change (see `getDeliveryProviderFor(store)` in `index.ts`).
 */

export interface DeliveryRequestInput {
  orderId: string;
  storeId: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: Record<string, unknown> | null;
  /** Store fields self_manual ignores entirely — only uber_direct needs a
   * real pickup location, a callable phone number, and the order's line
   * items/value to request an actual courier. */
  pickupAddress: string | null;
  storeName: string;
  storePhone: string | null;
  amountCents: number;
  manifestItems: { name: string; quantity: number }[];
}

export type DeliveryStatus = 'REQUESTED' | 'DELIVERED' | 'FAILED';

export interface DeliveryRequestResult {
  /** Opaque id from the provider, if any — stored on Delivery.providerDeliveryId. */
  providerDeliveryId: string | null;
  status: DeliveryStatus;
  /** Customer-facing tracking link, if the provider has one. */
  trackingUrl?: string;
}

export interface DeliveryProvider {
  /** Short identifier (used for logging + DB Delivery.provider). */
  name: string;

  requestDelivery(input: DeliveryRequestInput): Promise<DeliveryRequestResult>;

  /** Marks an in-flight delivery as completed. self-manual: trusts the
   * seller's own click, no external confirmation to wait for. A real
   * courier integration would instead learn this from its own webhook and
   * might not need this method called at all from our side. */
  markDelivered(providerDeliveryId: string | null): Promise<{ status: 'DELIVERED' }>;
}
