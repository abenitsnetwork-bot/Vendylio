'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { handleGateError } from '@/lib/upgradePrompt';
import { UpgradeModalHost } from '@/components/seller/UpgradeModalHost';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { ImageDropzone } from '@/components/ui/ImageDropzone';
import { cn } from '@/lib/utils';
import type { CategoryOption } from '@/lib/productCategories';
import { PRODUCT_UNITS, type ProductUnit } from '@/lib/productUnits';
import { isValidQuantityForUnit, roundQuantity } from '@/lib/quantity';
import { VariantManager } from '@/components/seller/VariantManager';
import { VariantDraftEditor, type DraftVariant } from '@/components/seller/VariantDraftEditor';

const AI_ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: 'AI description generation isn’t configured yet — contact support.',
  TOO_MANY_REQUESTS: 'Too many AI requests — try again in a bit.',
};

export interface ProductFields {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  quantity: number;
  categoryId: string | null;
  category?: { id: string; name: string; slug: string } | null;
  unit: string;
  lowStockThreshold: number | null;
  imageUrl: string | null;
  status: string;
}

interface CreateProps {
  mode: 'create';
  onCreated: (name: string) => void;
}

interface EditProps {
  mode: 'edit';
  product: ProductFields;
  onSaved: (product: ProductFields) => void;
  onDeleted: () => void;
}

export function ProductForm(props: CreateProps | EditProps) {
  const router = useRouter();
  const initial = props.mode === 'edit' ? props.product : null;

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [price, setPrice] = useState(initial ? (initial.priceCents / 100).toFixed(2) : '');
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [unit, setUnit] = useState<ProductUnit>((initial?.unit as ProductUnit) ?? 'UNIT');
  const [lowStockThreshold, setLowStockThreshold] = useState(
    initial?.lowStockThreshold != null ? String(initial.lowStockThreshold) : '',
  );
  const [storeDefaultThreshold, setStoreDefaultThreshold] = useState<number | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>(
    initial?.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [draftVariants, setDraftVariants] = useState<DraftVariant[]>([]);

  useEffect(() => {
    api<{ categories: CategoryOption[] }>('/api/categories')
      .then((res) => setCategories(res.categories))
      .catch(() => setCategories([]));
    api<{ store: { defaultLowStockThreshold: number } }>('/api/stores/me')
      .then((res) => setStoreDefaultThreshold(res.store.defaultLowStockThreshold))
      .catch(() => setStoreDefaultThreshold(null));
  }, []);

  const categoryName = categories.find((c) => c.id === categoryId)?.name ?? null;

  async function onGenerateDescription() {
    if (!name.trim()) {
      setAiError('Enter a product name first.');
      return;
    }
    setAiError(null);
    setGeneratingDescription(true);
    try {
      const res = await api<{ description: string }>('/api/ai/generate-description', {
        method: 'POST',
        body: { kind: 'product', name, ...(categoryName ? { category: categoryName } : {}), unit },
      });
      setDescription(res.description);
    } catch (err) {
      if (handleGateError(err)) {
        setGeneratingDescription(false);
        return;
      }
      setAiError(
        err instanceof ApiError
          ? (AI_ERROR_MESSAGES[err.code] ?? 'Could not generate a description. Try again.')
          : 'Network error. Try again.',
      );
    } finally {
      setGeneratingDescription(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const priceCents = Math.round(Number(price) * 100);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      setError('Enter a valid price.');
      return;
    }
    const quantityNum = roundQuantity(Number(quantity));
    if (!Number.isFinite(quantityNum) || quantityNum < 0) {
      setError('Enter a valid quantity.');
      return;
    }
    if (!isValidQuantityForUnit(quantityNum, unit)) {
      setError('Quantity must be a whole number for a per-item product.');
      return;
    }

    const parsedThreshold = lowStockThreshold.trim() === '' ? null : Number(lowStockThreshold);
    if (parsedThreshold !== null && (!Number.isInteger(parsedThreshold) || parsedThreshold < 0)) {
      setError('Low-stock threshold must be a whole number (0 or more).');
      return;
    }

    if (
      props.mode === 'create' &&
      draftVariants.some((v) => !isValidQuantityForUnit(v.quantity, unit))
    ) {
      setError('Each variant quantity must be a whole number for a per-item product.');
      return;
    }

    setSubmitting(true);
    try {
      if (props.mode === 'create') {
        await api('/api/products', {
          method: 'POST',
          body: {
            name,
            ...(description ? { description } : {}),
            priceCents,
            quantity: quantityNum,
            categoryId,
            unit,
            ...(parsedThreshold !== null ? { lowStockThreshold: parsedThreshold } : {}),
            ...(imageUrl ? { imageUrl } : {}),
            ...(draftVariants.length > 0 ? { variants: draftVariants } : {}),
          },
        });
        props.onCreated(name);
      } else {
        const res = await api<{ product: ProductFields }>(`/api/products/${props.product.id}`, {
          method: 'PATCH',
          body: {
            name,
            description: description || null,
            priceCents,
            quantity: quantityNum,
            categoryId,
            unit,
            lowStockThreshold: parsedThreshold,
            imageUrl,
            status,
          },
        });
        props.onSaved(res.product);
      }
    } catch (err) {
      const map: Record<string, string> = {
        NO_STORE: 'Create your store first.',
        VALIDATION_FAILED: 'Please check the fields and try again.',
        PRODUCT_NOT_FOUND: 'This product no longer exists.',
      };
      if (err instanceof ApiError && err.code === 'NO_STORE') router.push('/onboarding');
      setError(
        err instanceof ApiError ? (map[err.code] ?? err.message) : 'Network error. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete() {
    if (props.mode !== 'edit') return;
    setDeleting(true);
    setError(null);
    try {
      await api(`/api/products/${props.product.id}`, { method: 'DELETE' });
      props.onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error. Try again.');
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-3xl">
      <UpgradeModalHost />
      {props.mode === 'create' && (
        <div className="mb-10 flex items-center gap-3">
          <div className="h-1 flex-1 rounded-full bg-primary" />
          <div className="h-1 flex-1 rounded-full bg-muted" />
          <div className="h-1 flex-1 rounded-full bg-muted" />
        </div>
      )}

      <div className="space-y-8">
        <Field label="Product Name" htmlFor="productName">
          <input
            id="productName"
            className={inputClass}
            placeholder="e.g. Shea Butter 250g"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label="Description" htmlFor="productDescription">
          <textarea
            id="productDescription"
            className={`${inputClass} min-h-24`}
            placeholder="Tell customers about this product. What makes it special?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button
            type="button"
            onClick={onGenerateDescription}
            disabled={generatingDescription}
            className="mt-2 text-xs font-medium text-accent disabled:opacity-50"
          >
            {generatingDescription ? 'Generating…' : '✨ Generate with AI'}
          </button>
          {aiError && (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {aiError}
            </p>
          )}
        </Field>

        <Field label="Sold By" htmlFor="unit">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {PRODUCT_UNITS.map((u) => (
              <button
                key={u.value}
                type="button"
                onClick={() => setUnit(u.value)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-center text-xs',
                  unit === u.value
                    ? 'border-accent bg-secondary font-medium text-foreground'
                    : 'border-border text-muted-foreground',
                )}
              >
                {u.label}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Field
            label={
              unit === 'UNIT'
                ? 'Price'
                : `Price ${PRODUCT_UNITS.find((u) => u.value === unit)?.suffix}`
            }
            htmlFor="price"
          >
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted-foreground">
                $
              </span>
              <input
                id="price"
                type="number"
                min="0.01"
                step="0.01"
                required
                className={`${inputClass} pl-7`}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          </Field>
          <Field
            label={
              unit === 'UNIT' ? 'Quantity Available' : `Quantity Available (${unit.toLowerCase()})`
            }
            htmlFor="quantity"
          >
            <input
              id="quantity"
              type="number"
              min="0"
              step={unit === 'UNIT' ? '1' : '0.01'}
              required
              placeholder={
                unit === 'UNIT'
                  ? 'How many units do you have?'
                  : `e.g. 12.09 (how many ${unit.toLowerCase()} do you have?)`
              }
              className={inputClass}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Product Image (Optional)" htmlFor="productImage">
          <ImageDropzone
            label="Click to upload or drag and drop"
            hint="PNG, JPG up to 5MB"
            value={imageUrl}
            onUploaded={setImageUrl}
            onRemove={() => setImageUrl(null)}
          />
        </Field>

        <Field label="Category" htmlFor="category">
          <select
            id="category"
            className={inputClass}
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value || null)}
          >
            <option value="">Uncategorized</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Manage your categories in{' '}
            <a href="/dashboard/settings?tab=categories" className="text-accent">
              Store Settings
            </a>
            .
          </p>
        </Field>

        <Field label="Low-stock alert (optional)" htmlFor="lowStockThreshold">
          <input
            id="lowStockThreshold"
            type="number"
            min="0"
            step="1"
            className={inputClass}
            placeholder={
              storeDefaultThreshold !== null ? `Store default: ${storeDefaultThreshold}` : 'e.g. 5'
            }
            value={lowStockThreshold}
            onChange={(e) => setLowStockThreshold(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            You&apos;ll be warned when stock drops to this number. Leave blank to use the store
            default.
          </p>
        </Field>

        {props.mode === 'edit' && (
          <Field label="Availability" htmlFor="status">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setStatus('ACTIVE')}
                className={cn(
                  'rounded-lg border px-4 py-3 text-left',
                  status === 'ACTIVE'
                    ? 'border-accent bg-secondary'
                    : 'border-border text-muted-foreground',
                )}
              >
                <p className="text-sm font-medium text-foreground">Active</p>
                <p className="text-xs text-muted-foreground">Customers can see and buy this.</p>
              </button>
              <button
                type="button"
                onClick={() => setStatus('ARCHIVED')}
                className={cn(
                  'rounded-lg border px-4 py-3 text-left',
                  status === 'ARCHIVED'
                    ? 'border-accent bg-secondary'
                    : 'border-border text-muted-foreground',
                )}
              >
                <p className="text-sm font-medium text-foreground">Inactive</p>
                <p className="text-xs text-muted-foreground">
                  Hidden from customers. Turn it back on anytime.
                </p>
              </button>
            </div>
          </Field>
        )}

        <div className="border-t border-border pt-8">
          {props.mode === 'edit' ? (
            <VariantManager productId={props.product.id} unit={unit} />
          ) : (
            <VariantDraftEditor onChange={setDraftVariants} unit={unit} />
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-6">
          <button
            type="button"
            onClick={() =>
              router.push(props.mode === 'edit' ? '/dashboard/products' : '/dashboard')
            }
            className="flex-1 rounded-lg border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground hover:bg-secondary"
          >
            Cancel
          </button>
          <Button type="submit" disabled={submitting} className="flex-1 py-3">
            {submitting ? 'Saving…' : props.mode === 'create' ? 'Add Product' : 'Save Changes'}
          </Button>
        </div>

        {props.mode === 'edit' && (
          <div className="border-t border-border pt-6">
            {confirmingDelete ? (
              <div className="flex items-center gap-3">
                <p className="flex-1 text-sm text-muted-foreground">
                  Delete this product? This can&apos;t be undone.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="text-sm font-medium text-muted-foreground"
                >
                  Keep it
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={deleting}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="text-sm font-medium text-red-600"
              >
                Delete this product
              </button>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
