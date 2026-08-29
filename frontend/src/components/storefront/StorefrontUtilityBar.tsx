'use client';

import { Icon } from '@/components/ui/Icon';
import { useCart } from '@/contexts/CartContext';
import { formatUsdPerUnit } from '@/lib/productUnits';

/**
 * The green bar at the very top of the storefront — the buyer's shopping
 * context in one place: how they want the order (Delivery / Pickup) and how
 * to reach the store (phone). Replaced the separate contact strip +
 * fulfillment toggle. The choice is stored on the cart and pre-selects at
 * checkout; the server still re-prices every order.
 */
export function StorefrontUtilityBar({
  phone,
  acceptingOrders,
  deliveryFeeCents,
  deliveryProvider,
  pickupAddress,
}: {
  phone: string | null;
  acceptingOrders: boolean;
  deliveryFeeCents: number;
  deliveryProvider: string;
  pickupAddress: string | null;
}) {
  const { fulfillmentMethod, setFulfillmentMethod } = useCart();

  if (!phone && !acceptingOrders) return null;

  const deliveryHint =
    deliveryProvider === 'uber_direct'
      ? 'fee at checkout'
      : deliveryFeeCents > 0
        ? `+ ${formatUsdPerUnit(deliveryFeeCents, 'UNIT')}`
        : 'free';

  const options = [
    { value: 'delivery' as const, label: 'Delivery', hint: deliveryHint },
    {
      value: 'pickup' as const,
      label: 'Pickup',
      hint: pickupAddress ? `at ${pickupAddress}` : 'free',
    },
  ];

  return (
    <div className="bg-panel text-panel-foreground">
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-8 xl:px-10">
        {acceptingOrders ? (
          <div
            role="radiogroup"
            aria-label="How would you like to receive your order?"
            className="flex gap-1.5"
          >
            {options.map((opt) => {
              const active = fulfillmentMethod === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setFulfillmentMethod(opt.value)}
                  className={`flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? 'border-panel-foreground bg-panel-foreground text-panel'
                      : 'border-panel-foreground/30 text-panel-foreground/75 hover:border-panel-foreground'
                  }`}
                >
                  <span className="font-semibold">{opt.label}</span>
                  <span className={`truncate ${active ? 'text-panel/70' : 'opacity-70'}`}>
                    {opt.hint}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <span aria-hidden="true" />
        )}

        {phone && (
          <a
            href={`tel:${phone}`}
            className="flex flex-shrink-0 items-center gap-1.5 text-sm font-semibold hover:underline"
          >
            <Icon i="phone" size={14} />
            {phone}
          </a>
        )}
      </div>
    </div>
  );
}
