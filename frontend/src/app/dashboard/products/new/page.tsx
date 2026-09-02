'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { SellerModalHeader } from '@/components/seller/SellerModalHeader';
import { ProductForm } from '@/components/seller/ProductForm';
import { ProductAddedSuccess } from '@/components/seller/ProductAddedSuccess';

export default function AddProductPage() {
  const user = useUser();
  const router = useRouter();
  const [addedProductName, setAddedProductName] = useState<string | null>(null);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background font-body">
      <SellerModalHeader closeHref="/dashboard" />
      <div className="px-4 py-8 lg:px-14 lg:py-12">
        {addedProductName ? (
          <ProductAddedSuccess
            productName={addedProductName}
            onAddAnother={() => setAddedProductName(null)}
            onGoToDashboard={() => router.push('/dashboard')}
          />
        ) : (
          <>
            <div className="mx-auto mb-10 max-w-3xl">
              <Link
                href="/dashboard"
                className="mb-6 flex items-center gap-2 text-sm font-medium text-accent"
              >
                <Icon i="arrow-left" size={16} />
                Back to Dashboard
              </Link>
              <h1
                className="mb-2 font-headings font-bold text-foreground"
                style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
              >
                Add a new product
              </h1>
              <p className="text-base text-muted-foreground">
                Tell us what you&apos;re selling. Photos are optional — text descriptions work great
                too.
              </p>
            </div>
            <ProductForm mode="create" onCreated={setAddedProductName} />
          </>
        )}
      </div>
    </div>
  );
}
