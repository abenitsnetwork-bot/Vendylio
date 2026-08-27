'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { inputClass } from '@/components/ui/Field';
import { isValidQuantityForUnit, roundQuantity } from '@/lib/quantity';

export interface Variant {
  id: string;
  name: string;
  value: string;
  priceDeltaCents: number;
  quantity: number;
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Independent variant options for one product (e.g. "Size: Large", "1kg
 * bag") — not a Size×Color matrix, just a flat list a buyer picks one row
 * from at checkout. Manages its own fetch/mutations against
 * /api/products/[id]/variants so ProductForm stays focused on the base
 * product fields.
 */
export function VariantManager({ productId, unit }: { productId: string; unit: string }) {
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDelta, setNewDelta] = useState('0.00');
  const [newQuantity, setNewQuantity] = useState('0');
  const [adding, setAdding] = useState(false);

  function load() {
    api<{ variants: Variant[] }>(`/api/products/${productId}`)
      .then((res) => setVariants(res.variants))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load variants.');
      });
  }

  useEffect(load, [productId]);

  async function onAdd() {
    setError(null);
    const priceDeltaCents = Math.round(Number(newDelta) * 100);
    const quantity = roundQuantity(Number(newQuantity));
    if (!newName.trim() || !newValue.trim()) {
      setError('Enter both an option name (e.g. Size) and a value (e.g. Large).');
      return;
    }
    if (!Number.isFinite(priceDeltaCents) || !Number.isFinite(quantity) || quantity < 0) {
      setError('Enter a valid price adjustment and quantity.');
      return;
    }
    if (!isValidQuantityForUnit(quantity, unit)) {
      setError('Quantity must be a whole number for a per-item product.');
      return;
    }
    setAdding(true);
    try {
      await api(`/api/products/${productId}/variants`, {
        method: 'POST',
        body: { name: newName.trim(), value: newValue.trim(), priceDeltaCents, quantity },
      });
      setNewName('');
      setNewValue('');
      setNewDelta('0.00');
      setNewQuantity('0');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this variant.');
    } finally {
      setAdding(false);
    }
  }

  async function onUpdateQuantity(variant: Variant, rawQuantity: number) {
    const quantity = roundQuantity(rawQuantity);
    if (!Number.isFinite(quantity) || quantity < 0 || !isValidQuantityForUnit(quantity, unit)) {
      setError('Quantity must be a whole number for a per-item product.');
      return;
    }
    try {
      await api(`/api/products/${productId}/variants/${variant.id}`, {
        method: 'PATCH',
        body: { quantity },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this variant.');
    }
  }

  async function onDelete(variantId: string) {
    try {
      await api(`/api/products/${productId}/variants/${variantId}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this variant.');
    }
  }

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-foreground">Variants (optional)</p>
      <p className="mb-4 text-xs text-muted-foreground">
        Independent options a buyer picks one of at checkout — e.g. Size: Small / Large, or 250g /
        500g / 1kg bags. Leave empty if this product doesn&apos;t need options.
      </p>

      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {variants === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="mb-4 space-y-2">
          {variants.map((v) => (
            <div
              key={v.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {v.name}: {v.value}
                </p>
                <p className="text-xs text-muted-foreground">
                  {v.priceDeltaCents === 0
                    ? 'No price change'
                    : `${v.priceDeltaCents > 0 ? '+' : ''}$${centsToInput(v.priceDeltaCents)}`}
                </p>
              </div>
              <input
                type="number"
                min="0"
                step={unit === 'UNIT' ? '1' : '0.01'}
                aria-label={`Quantity for ${v.name}: ${v.value}`}
                className={`${inputClass} w-20 py-1.5 text-sm`}
                defaultValue={v.quantity}
                onBlur={(e) => onUpdateQuantity(v, Number(e.target.value))}
              />
              <button
                type="button"
                onClick={() => onDelete(v.id)}
                aria-label={`Remove ${v.name}: ${v.value}`}
                className="text-muted-foreground hover:text-red-600"
              >
                <Icon i="x" size={16} />
              </button>
            </div>
          ))}
          {variants.length === 0 && (
            <p className="text-sm text-muted-foreground">No variants yet.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-dashed border-border p-3 sm:grid-cols-4">
        <input
          placeholder="Option (e.g. Size)"
          className={`${inputClass} text-sm`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <input
          placeholder="Value (e.g. Large)"
          className={`${inputClass} text-sm`}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
        />
        <input
          type="number"
          step="0.01"
          placeholder="Price +/-"
          className={`${inputClass} text-sm`}
          value={newDelta}
          onChange={(e) => setNewDelta(e.target.value)}
        />
        <div className="flex gap-2">
          <input
            type="number"
            min="0"
            step={unit === 'UNIT' ? '1' : '0.01'}
            placeholder="Qty"
            className={`${inputClass} text-sm`}
            value={newQuantity}
            onChange={(e) => setNewQuantity(e.target.value)}
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={adding}
            className="flex-shrink-0 whitespace-nowrap rounded-lg bg-foreground px-3 text-sm font-semibold text-background disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
