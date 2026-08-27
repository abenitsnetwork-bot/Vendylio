'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { SellerModalHeader } from '@/components/seller/SellerModalHeader';
import { ProductForm, type ProductFields } from '@/components/seller/ProductForm';

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useUser();
  const router = useRouter();
  const [product, setProduct] = useState<ProductFields | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<{ product: ProductFields }>(`/api/products/${id}`)
      .then((res) => setProduct(res.product))
      .catch((err) => {
        const message =
          err instanceof ApiError && err.code === 'PRODUCT_NOT_FOUND'
            ? 'This product no longer exists.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load this product.';
        setError(message);
      });
  }, [user, id]);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background font-body">
      <SellerModalHeader closeHref="/dashboard/products" />
      <div className="px-4 py-8 lg:px-14 lg:py-12">
        <div className="mx-auto mb-10 max-w-3xl">
          <Link
            href="/dashboard/products"
            className="mb-6 flex items-center gap-2 text-sm font-medium text-primary"
          >
            <Icon i="arrow-left" size={16} />
            Back to Products
          </Link>
          <h1
            className="mb-2 font-headings font-bold text-foreground"
            style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
          >
            Edit product
          </h1>
        </div>

        {error && <p className="mx-auto max-w-3xl text-sm text-red-600">{error}</p>}
        {!error && !product && (
          <p className="mx-auto max-w-3xl text-sm text-muted-foreground">Loading…</p>
        )}
        {product && (
          <ProductForm
            mode="edit"
            product={product}
            onSaved={() => router.push('/dashboard/products')}
            onDeleted={() => router.push('/dashboard/products')}
          />
        )}
      </div>
    </div>
  );
}
