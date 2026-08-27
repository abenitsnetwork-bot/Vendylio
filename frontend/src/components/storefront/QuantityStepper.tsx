import { roundQuantity } from '@/lib/quantity';

/** How many of the currently-selected item to add. Unit-aware, same
 * UNIT-vs-weight split as CartDrawer's own quantity control, but this one
 * edits a local "about to add" amount rather than an existing cart line. */
export function QuantityStepper({
  quantity,
  unit,
  max,
  onChange,
}: {
  quantity: number;
  unit: string;
  max: number;
  onChange: (quantity: number) => void;
}) {
  if (unit === 'UNIT') {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, quantity - 1))}
          disabled={quantity <= 1}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Decrease quantity"
        >
          −
        </button>
        <span className="w-6 text-center text-sm font-medium text-foreground">{quantity}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, quantity + 1))}
          disabled={quantity >= max}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>
    );
  }

  return (
    <input
      type="number"
      min="0.01"
      max={max}
      step="0.01"
      value={quantity}
      onChange={(e) =>
        onChange(roundQuantity(Math.max(0.01, Math.min(Number(e.target.value) || 0.01, max))))
      }
      aria-label={`Quantity in ${unit.toLowerCase()}`}
      className="w-24 rounded-lg border border-border px-3 py-2 text-sm text-foreground"
    />
  );
}
