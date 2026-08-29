import { splitUsdPerUnit } from '@/lib/productUnits';

/**
 * Storefront price display — dollars at full size, cents raised and smaller,
 * unit suffix ("/lb") muted. Used on product cards and the detail page so
 * pricing reads big and confident without the ".00" dominating.
 *
 * `className` styles the whole price (font, size, weight, color); the cents
 * and suffix scale relative to it via `em`.
 */
export function PriceTag({
  cents,
  unit,
  className,
}: {
  cents: number;
  unit: string;
  className?: string;
}) {
  const { dollars, cents: frac, suffix } = splitUsdPerUnit(cents, unit);
  return (
    <span className={className}>
      {dollars}
      <span className="align-top text-[0.62em] font-bold">.{frac}</span>
      {suffix && (
        <span className="ml-0.5 text-[0.6em] font-medium text-muted-foreground">{suffix}</span>
      )}
    </span>
  );
}
