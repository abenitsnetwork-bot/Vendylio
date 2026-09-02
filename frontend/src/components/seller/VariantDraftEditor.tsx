'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { inputClass } from '@/components/ui/Field';

// Draft variant, ready for POST /api/products (dollars already → cents).
export interface DraftVariant {
  name: string;
  value: string;
  priceDeltaCents: number;
  quantity: number;
}

// What the editor holds while the seller types — strings so a half-typed
// "-1." or "" doesn't snap to 0. Converted to DraftVariant on every change.
interface Row {
  name: string;
  value: string;
  price: string;
  qty: string;
}

const BLANK: Row = { name: '', value: '', price: '', qty: '0' };

function toDraft(rows: Row[]): DraftVariant[] {
  return rows
    .filter((r) => r.name.trim() !== '' && r.value.trim() !== '')
    .map((r) => ({
      name: r.name.trim(),
      value: r.value.trim(),
      priceDeltaCents: Math.round((Number(r.price) || 0) * 100),
      quantity: Math.max(0, Number(r.qty) || 0),
    }));
}

/**
 * Variant options captured DURING product creation — mirrors VariantManager's
 * layout but holds everything in local state and hands the parent a clean
 * DraftVariant[] (the parent sends it in the POST /api/products body). After
 * the product exists, the edit screen's VariantManager takes over.
 */
export function VariantDraftEditor({
  onChange,
  unit,
}: {
  onChange: (variants: DraftVariant[]) => void;
  unit: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);

  function commit(next: Row[]) {
    setRows(next);
    onChange(toDraft(next));
  }

  const update = (i: number, patch: Partial<Row>) =>
    commit(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => commit([...rows, { ...BLANK }]);
  const removeRow = (i: number) => commit(rows.filter((_, idx) => idx !== i));

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-foreground">Variants (optional)</p>
      <p className="mb-4 text-xs text-muted-foreground">
        Independent options a buyer picks one of at checkout — e.g. Size: Small / Large, or 250g /
        500g / 1kg bags. &ldquo;Price +/&ndash;&rdquo; is added to (or subtracted from) the price
        above. You can fine-tune these later on the product&apos;s edit page.
      </p>

      {rows.length > 0 && (
        <div className="mb-3 space-y-2">
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-center"
            >
              <input
                placeholder="Option (e.g. Size)"
                aria-label="Option name"
                className={`${inputClass} text-sm`}
                value={r.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <input
                placeholder="Value (e.g. Large)"
                aria-label="Option value"
                className={`${inputClass} text-sm`}
                value={r.value}
                onChange={(e) => update(i, { value: e.target.value })}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Price +/–"
                aria-label="Price adjustment"
                className={`${inputClass} text-sm sm:w-24`}
                value={r.price}
                onChange={(e) => update(i, { price: e.target.value })}
              />
              <input
                type="number"
                min="0"
                step={unit === 'UNIT' ? '1' : '0.01'}
                placeholder="Qty"
                aria-label="Quantity"
                className={`${inputClass} text-sm sm:w-20`}
                value={r.qty}
                onChange={(e) => update(i, { qty: e.target.value })}
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label={`Remove variant ${i + 1}`}
                className="justify-self-end text-muted-foreground hover:text-red-600"
              >
                <Icon i="x" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
      >
        <Icon i="plus" size={16} />
        Add a variant
      </button>
    </div>
  );
}
