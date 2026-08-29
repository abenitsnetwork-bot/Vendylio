'use client';

import { useCart } from '@/contexts/CartContext';
import { formatUsdPerUnit } from '@/lib/productUnits';

/**
 * Phase C — a Delivery / Pickup segmented control shown near the top of the
 * storefront. The choice is stored on the cart (localStorage) and becomes
 * the pre-selected fulfillment method at checkout. Informational only — the
 * server re-prices every order (pickup always zeroes the delivery fee).
 */
export function StorefrontFulfillmentToggle({
  deliveryFeeCents,
  deliveryProvider,
  pickupAddress,
}: {
  deliveryFeeCents: number;
  deliveryProvider: string;
  pickupAddress: string | null;
}) {
  const { fulfillmentMethod, setFulfillmentMethod } = useCart();

  // Uber Direct quotes by distance at checkout, so any number here would be a
  // guess — only show a concrete fee for the flat self_manual case.
  const deliveryHint =
    deliveryProvider === 'uber_direct'
      ? 'Fee calculated at checkout'
      : deliveryFeeCents > 0
        ? `+ ${formatUsdPerUnit(deliveryFeeCents, 'UNIT')}`
        : 'Free';

  const options = [
    { value: 'delivery' as const, label: 'Delivery', hint: deliveryHint },
    {
      value: 'pickup' as const,
      label: 'Pickup',
      hint: pickupAddress ? `at ${pickupAddress}` : 'Free',
    },
  ];

  return (
    <div className="border-b border-border bg-card px-4 py-3 lg:px-14">
      <div
        role="radiogroup"
        aria-label="How would you like to receive your order?"
        className="mx-auto flex max-w-6xl gap-2"
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
              className={`flex flex-1 flex-col items-center rounded-xl border px-3 py-2 text-center transition-colors sm:flex-none sm:flex-row sm:gap-2 ${
                active
                  ? 'border-primary bg-secondary'
                  : 'border-border text-muted-foreground hover:border-primary'
              }`}
            >
              <span className="text-sm font-semibold text-foreground">{opt.label}</span>
              <span className="truncate text-xs text-muted-foreground">{opt.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
