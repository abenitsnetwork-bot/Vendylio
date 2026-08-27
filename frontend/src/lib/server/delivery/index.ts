import 'server-only';
import type { DeliveryProvider } from './provider';
import { createSelfManualProvider } from './self-manual';
import { createUberDirectProvider } from './uber-direct';

/** Resolves the DeliveryProvider for a Store's `deliveryProvider` column. */
export function getDeliveryProviderFor(deliveryProvider: string): DeliveryProvider {
  switch (deliveryProvider) {
    case 'uber_direct':
      return createUberDirectProvider();
    case 'self_manual':
    default:
      return createSelfManualProvider();
  }
}

export type { DeliveryProvider, DeliveryRequestInput, DeliveryRequestResult } from './provider';
