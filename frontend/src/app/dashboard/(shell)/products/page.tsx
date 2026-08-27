'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { sellerFirstName } from '@/lib/utils';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { productCategoryLabel } from '@/lib/productCategories';
import { formatUsdPerUnit, formatQuantityWithUnit } from '@/lib/productUnits';
import type { ProductFields } from '@/components/seller/ProductForm';

export default function ProductsPage() {
  const user = useUser();
  const { logout } = useAuth();
  const [products, setProducts] = useState<ProductFields[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<{ products: ProductFields[] }>('/api/products')
      .then((res) => setProducts(res.products))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load your products.');
      });
  }, [user]);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background font-body">
      <SellerHeader
        userName={sellerFirstName(user)}
        userEmail={user.email}
        onSignOut={async () => {
          await logout();
        }}
      />
      <div className="px-4 py-12 lg:px-14">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Link
                href="/dashboard"
                className="mb-6 flex items-center gap-2 text-sm font-medium text-primary"
              >
                <Icon i="arrow-left" size={16} />
                Back to Dashboard
              </Link>
              <h1
                className="mb-2 font-headings font-bold text-foreground"
                style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
              >
                Your Products
              </h1>
              <p className="text-base text-muted-foreground">
                Edit, replace photos, or remove products from your store.
              </p>
            </div>
            <Link
              href="/dashboard/products/new"
              className="inline-block whitespace-nowrap rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Add Product
            </Link>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && products === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!error && products !== null && products.length === 0 && (
            <div className="rounded-lg border border-border bg-card py-16 text-center">
              <Icon
                i="package"
                size={32}
                className="mx-auto mb-4 text-muted-foreground opacity-50"
              />
              <p className="mb-4 text-sm text-muted-foreground">No products yet.</p>
              <Link href="/dashboard/products/new" className="text-sm font-medium text-primary">
                Add your first product
              </Link>
            </div>
          )}
          {products && products.length > 0 && (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <Link
                  key={product.id}
                  href={`/dashboard/products/${product.id}/edit`}
                  className="overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary"
                >
                  <div className="relative">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="h-40 w-full object-cover"
                      />
                    ) : (
                      <ImagePlaceholder icon="package" className="h-40 w-full" />
                    )}
                    {product.quantity <= 0 && (
                      <span className="absolute right-3 top-3 rounded bg-foreground px-2 py-1 text-xs font-semibold text-background">
                        Sold out
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <span className="mb-2 inline-block rounded bg-secondary px-2 py-0.5 text-xs font-medium text-primary">
                      {productCategoryLabel(product.category)}
                    </span>
                    <p className="mb-1 font-semibold text-foreground">{product.name}</p>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-bold text-foreground">
                        {formatUsdPerUnit(product.priceCents, product.unit)}
                      </span>
                      <span className="text-muted-foreground">
                        {formatQuantityWithUnit(product.quantity, product.unit)} in stock
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
