'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { ImageDropzone } from '@/components/ui/ImageDropzone';

// Banani's StoreSetupForm shows a 3-step progress bar ("Store Basics" /
// "Products" / "Delivery") but only step 1 has real fields anywhere in the
// fetched source — steps 2/3 are decorative labels with no content. This
// ships step 1 as the actual form; it creates the Store and hands off to
// the dashboard rather than fabricating steps Banani never specified.
const AI_ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: 'AI description generation isn’t configured yet — contact support.',
  TOO_MANY_REQUESTS: 'Too many AI requests — try again in a bit.',
};

export function StoreSetupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function onGenerateDescription() {
    if (!name.trim()) {
      setAiError('Enter a store name first.');
      return;
    }
    setAiError(null);
    setGeneratingDescription(true);
    try {
      const res = await api<{ description: string }>('/api/ai/generate-description', {
        method: 'POST',
        body: { kind: 'store', name, ...(city ? { city } : {}), ...(state ? { state } : {}) },
      });
      setDescription(res.description);
    } catch (err) {
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
    setSubmitting(true);
    try {
      await api('/api/stores', {
        method: 'POST',
        body: {
          name,
          ...(description ? { description } : {}),
          ...(city ? { city } : {}),
          ...(state ? { state } : {}),
          ...(logoUrl ? { logoUrl } : {}),
        },
      });
      router.push('/dashboard');
    } catch (err) {
      const map: Record<string, string> = {
        STORE_ALREADY_EXISTS: 'You already have a store.',
        VALIDATION_FAILED: 'Please check the fields and try again.',
      };
      setError(
        err instanceof ApiError ? (map[err.code] ?? err.message) : 'Network error. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-2xl">
      {/* Progress indicator */}
      <div className="mb-10 flex items-center gap-4 lg:mb-12">
        {[
          { n: 1, label: 'Store Basics', active: true },
          { n: 2, label: 'Products', active: false },
          { n: 3, label: 'Delivery', active: false },
        ].map((step) => (
          <div key={step.n} className="flex-1">
            <div className="mb-2 flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                  step.active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {step.n}
              </div>
              <span
                className={`hidden text-sm sm:inline ${step.active ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
              >
                {step.label}
              </span>
            </div>
            <div className={`h-0.5 ${step.active ? 'bg-primary' : 'bg-muted'}`} />
          </div>
        ))}
      </div>

      <div className="space-y-6">
        <Field label="Store Name" htmlFor="storeName">
          <input
            id="storeName"
            className={inputClass}
            placeholder="e.g. Adaeze's Shea Butter"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label="Store Description" htmlFor="storeDescription">
          <textarea
            id="storeDescription"
            className={`${inputClass} min-h-24`}
            placeholder="Tell customers what you sell..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button
            type="button"
            onClick={onGenerateDescription}
            disabled={generatingDescription}
            className="mt-2 text-xs font-medium text-primary disabled:opacity-50"
          >
            {generatingDescription ? 'Generating…' : '✨ Generate with AI'}
          </button>
          {aiError && (
            <p role="alert" className="mt-1 text-xs text-red-600">
              {aiError}
            </p>
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="city">
            <input
              id="city"
              className={inputClass}
              placeholder="Maryland"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </Field>
          <Field label="State" htmlFor="state">
            <input
              id="state"
              className={inputClass}
              placeholder="Maryland"
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Store Logo or Photo" htmlFor="logo">
          <ImageDropzone
            label="Click to upload or drag and drop"
            hint="PNG, JPG up to 5MB"
            onUploaded={setLogoUrl}
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-4">
          <Button type="submit" disabled={submitting} className="flex-1 py-3">
            {submitting ? 'Creating…' : 'Create My Store'}
          </Button>
        </div>
      </div>
    </form>
  );
}
