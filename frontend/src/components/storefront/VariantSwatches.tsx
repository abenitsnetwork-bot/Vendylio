import { cn } from '@/lib/utils';
import {
  variantLabel,
  variantOptionPriceLabel,
  type ProductVariantOption,
} from '@/lib/productVariants';
import { isColorAxis, colorNameToHex } from '@/lib/colorSwatch';

/** One flat list of options (Phase 7 — no Size×Color matrix, a buyer picks
 * at most one variant total). Color-axis options with a recognized value
 * render as a real color circle; everything else renders as a text pill —
 * same selection semantics either way. When the options carry different
 * prices, each shows its own price so the shopper sees the cost before
 * choosing. */
export function VariantSwatches({
  variants,
  selectedId,
  onSelect,
  basePriceCents,
}: {
  variants: ProductVariantOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Product base price — enables the per-option price caption. */
  basePriceCents?: number;
}) {
  const showPrices =
    typeof basePriceCents === 'number' && variants.some((v) => v.priceDeltaCents !== 0);

  return (
    <div className="flex flex-wrap gap-3">
      {variants.map((v) => {
        const soldOut = v.quantity <= 0;
        const selected = v.id === selectedId;
        const hex = isColorAxis(v.name) ? colorNameToHex(v.value) : null;
        const priceText = showPrices ? variantOptionPriceLabel(basePriceCents, v) : null;
        const label = `${variantLabel(v)}${priceText ? ` — ${priceText}` : ''}${
          soldOut ? ' (sold out)' : ''
        }`;

        const control = hex ? (
          <button
            type="button"
            disabled={soldOut}
            onClick={() => onSelect(v.id)}
            title={label}
            aria-label={label}
            aria-pressed={selected}
            className={cn(
              'h-9 w-9 flex-shrink-0 rounded-full border-2 disabled:cursor-not-allowed disabled:opacity-30',
              selected ? 'border-primary' : 'border-border',
            )}
            style={{ backgroundColor: hex }}
          />
        ) : (
          <button
            type="button"
            disabled={soldOut}
            onClick={() => onSelect(v.id)}
            aria-label={label}
            aria-pressed={selected}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40',
              selected
                ? 'border-primary bg-secondary text-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            {variantLabel(v)}
            {soldOut ? ' (sold out)' : ''}
          </button>
        );

        return (
          <div key={v.id} className="flex flex-col items-center gap-1">
            {control}
            {priceText && (
              <span
                className={cn(
                  'text-[11px] font-semibold tabular-nums',
                  selected ? 'text-foreground' : 'text-muted-foreground',
                  soldOut && 'opacity-40',
                )}
              >
                {priceText}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
