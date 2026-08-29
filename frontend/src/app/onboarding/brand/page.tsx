'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { ImageDropzone } from '@/components/ui/ImageDropzone';
import { cn } from '@/lib/utils';
import { STORE_TEMPLATES, type StoreTemplate } from '@/lib/storeTemplates';
import { useOnboarding } from '../layout';

export default function BrandStepPage() {
  const { store, refresh } = useOnboarding();
  const router = useRouter();

  const [logoUrl, setLogoUrl] = useState<string | null>(store?.logoUrl ?? null);
  const [template, setTemplate] = useState<StoreTemplate>(
    (store?.template as StoreTemplate) ?? 'MODERN',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api('/api/stores', { method: 'PATCH', body: { logoUrl, template } });
      refresh();
      router.push('/onboarding/products');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1
          className="mb-2 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
        >
          Make it yours
        </h1>
        <p className="text-sm text-muted-foreground">
          Add a logo and pick a look — or skip this and use our defaults, they look great too.
        </p>
      </div>

      <div className="space-y-8">
        <Field label="Store Logo or Photo" htmlFor="logo">
          <ImageDropzone
            label="Click to upload or drag and drop"
            hint="PNG, JPG up to 5MB"
            value={logoUrl}
            onUploaded={setLogoUrl}
            onRemove={() => setLogoUrl(null)}
          />
        </Field>

        <div>
          <p className="mb-3 text-sm font-medium text-foreground">Storefront Look</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {STORE_TEMPLATES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTemplate(t.value)}
                className={cn(
                  'rounded-lg border p-4 text-left',
                  template === t.value ? 'border-primary bg-secondary' : 'border-border',
                )}
              >
                <p className="text-sm font-semibold text-foreground">{t.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={submitting} className="sm:px-10">
            {submitting ? 'Saving…' : 'Save & Continue'}
          </Button>
          <button
            type="button"
            onClick={() => router.push('/onboarding/products')}
            className="text-sm font-medium text-muted-foreground"
          >
            Skip for now
          </button>
        </div>
      </div>
    </form>
  );
}
