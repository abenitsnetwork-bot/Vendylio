import { cn } from '@/lib/utils';
import { variantLabel, type ProductVariantOption } from '@/lib/productVariants';
import { isColorAxis, colorNameToHex } from '@/lib/colorSwatch';

/** One flat list of options (Phase 7 — no Size×Color matrix, a buyer picks
 * at most one variant total). Color-axis options with a recognized value
 * render as a real color circle; everything else renders as a text pill —
 * same selection semantics either way. */
export function VariantSwatches({
  variants,
  selectedId,
  onSelect,
}: {
  variants: ProductVariantOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {variants.map((v) => {
        const soldOut = v.quantity <= 0;
        const selected = v.id === selectedId;
        const hex = isColorAxis(v.name) ? colorNameToHex(v.value) : null;
        const label = `${variantLabel(v)}${soldOut ? ' (sold out)' : ''}`;

        if (hex) {
          return (
            <button
              key={v.id}
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
          );
        }

        return (
          <button
            key={v.id}
            type="button"
            disabled={soldOut}
            onClick={() => onSelect(v.id)}
            aria-pressed={selected}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40',
              selected
                ? 'border-primary bg-secondary text-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
