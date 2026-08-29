'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ProductForm } from '@/components/seller/ProductForm';
import { useOnboarding } from '../layout';

interface ProductSummary {
  id: string;
  name: string;
  priceCents: number;
  imageUrl: string | null;
}

export default function ProductsStepPage() {
  const { refresh } = useOnboarding();
  const router = useRouter();
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ products: ProductSummary[] }>('/api/products')
      .then((res) => setProducts(res.products))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load products.'));
  }, []);

  function onCreated() {
    setShowForm(false);
    refresh();
    api<{ products: ProductSummary[] }>('/api/products')
      .then((res) => setProducts(res.products))
      .catch(() => {});
  }

  const hasProducts = (products?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1
          className="mb-2 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
        >
          Add your first product
        </h1>
        <p className="text-sm text-muted-foreground">
          You need at least one product before customers can buy from you.
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}

      {products === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {hasProducts && (
            <div className="mb-6 space-y-3">
              {products.map((p) => (
                <Card key={p.id} className="flex items-center gap-4 p-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Icon i="package" size={18} className="text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      ${(p.priceCents / 100).toFixed(2)}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {showForm || !hasProducts ? (
            <div className={hasProducts ? 'rounded-xl border border-border p-6' : ''}>
              <ProductForm mode="create" onCreated={onCreated} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="mb-6 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-4 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
            >
              <Icon i="plus" size={16} />
              Add another product
            </button>
          )}

          {hasProducts && !showForm && (
            <Button onClick={() => router.push('/onboarding/payments')} className="sm:px-10">
              Continue
            </Button>
          )}
        </>
      )}
    </div>
  );
}
