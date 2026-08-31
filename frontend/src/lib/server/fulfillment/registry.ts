/**
 * Prompt #12 — the provider registry. THE ONLY place a `ProviderType` maps to
 * a concrete adapter. Everywhere else asks `getDeliveryProvider(type)` and
 * talks to the `FulfillmentProvider` interface.
 *
 * Adding a courier (Lyft, Roadie): new `providers/<name>.ts` + one `case`
 * here. Nothing in checkout / orders / tracking / the dashboard changes.
 */
import 'server-only';
import type { FulfillmentProvider } from './provider';
import type { ProviderType } from './types';
import type { MethodConfigMerchant, MethodConfigPickup } from './config';
import { createPickupProvider } from './providers/pickup';
import { createMerchantProvider } from './providers/merchant';
import { createUberDirectFulfillmentProvider } from './providers/uber-direct';
import { createDoorDashFulfillmentProvider } from './providers/doordash';

/** Optional per-store context. MERCHANT / PICKUP need the store's configured
 *  fee + gates for `quote`; couriers ignore it. Omit it when you only need
 *  `normalizeStatus` / `friendlyName` / `capabilities` / `testConnection`. */
export interface ProviderContext {
  merchant?: MethodConfigMerchant;
  pickup?: MethodConfigPickup;
}

export function getDeliveryProvider(
  type: ProviderType,
  ctx: ProviderContext = {},
): FulfillmentProvider {
  switch (type) {
    case 'UBER_DIRECT':
      return createUberDirectFulfillmentProvider();
    case 'DOORDASH':
      return createDoorDashFulfillmentProvider();
    case 'MERCHANT':
      return ctx.merchant ? createMerchantProvider(ctx.merchant) : createMerchantProvider();
    case 'PICKUP':
      return createPickupProvider(ctx.pickup);
  }
}
