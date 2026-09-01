'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { previewSlug } from '@/lib/slugPreview';
import { TermsModal } from '@/components/legal/TermsModal';
import { useOnboarding } from '../layout';

const AI_ERROR_MESSAGES: Record<string, string> = {
  AI_NOT_CONFIGURED: 'AI description generation isn’t configured yet — contact support.',
  TOO_MANY_REQUESTS: 'Too many AI requests — try again in a bit.',
};

const ERROR_MESSAGES: Record<string, string> = {
  STORE_ALREADY_EXISTS: 'You already have a store.',
  VALIDATION_FAILED: 'Please check the fields and try again.',
  TERMS_NOT_ACCEPTED: 'Please accept the Terms & Conditions to continue.',
};

export default function BusinessStepPage() {
  const { store, refresh } = useOnboarding();
  const router = useRouter();
  const isEditing = store !== null;

  const [name, setName] = useState(store?.name ?? '');
  const [description, setDescription] = useState(store?.description ?? '');
  const [city, setCity] = useState(store?.city ?? '');
  const [state, setState] = useState(store?.state ?? '');
  const [phone, setPhone] = useState(store?.phone ?? '');
  const [slug, setSlug] = useState(store?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(isEditing);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  async function onGenerateDescription() {
    if (!name.trim()) {
      setAiError('Enter a business name first.');
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
      if (isEditing) {
        await api('/api/stores', {
          method: 'PATCH',
          body: {
            name,
            description,
            city,
            state,
            phone,
          },
        });
      } else {
        await api('/api/stores', {
          method: 'POST',
          body: {
            name,
            ...(description ? { description } : {}),
            ...(city ? { city } : {}),
            ...(state ? { state } : {}),
            ...(phone ? { phone } : {}),
            ...(slugTouched && slug ? { slug } : {}),
            termsAccepted: true,
          },
        });
      }
      refresh();
      router.push('/onboarding/brand');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (ERROR_MESSAGES[err.code] ?? err.message)
          : 'Network error. Try again.',
      );
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
          Tell us about your business
        </h1>
        <p className="text-sm text-muted-foreground">
          Just a few details — this is what customers will see on your store.
        </p>
      </div>

      <div className="space-y-6">
        <Field label="Business / Store Name" htmlFor="name">
          <input
            id="name"
            className={inputClass}
            placeholder="e.g. Adaeze's Shea Butter"
            required
            minLength={2}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {!isEditing && (
          <Field label="Your Store Link" htmlFor="slug">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-input px-4 py-3 text-sm focus-within:ring-2 focus-within:ring-primary">
              <span className="flex-shrink-0 text-muted-foreground">vendylio.com/s/</span>
              <input
                id="slug"
                className="w-full min-w-0 bg-transparent text-foreground focus:outline-none"
                value={slug || previewSlug(name)}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(previewSlug(e.target.value));
                }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              This is the link you&apos;ll share with your customers.
            </p>
          </Field>
        )}
        {isEditing && (
          <Field label="Your Store Link" htmlFor="slug-locked">
            <div className={inputClass}>vendylio.com/s/{store.slug}</div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Your store link can&apos;t be changed once your store is created — it&apos;s already
              yours to share.
            </p>
          </Field>
        )}

        <Field label="Business Description" htmlFor="description">
          <textarea
            id="description"
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
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </Field>
          <Field label="State" htmlFor="state">
            <input
              id="state"
              className={inputClass}
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Business Phone (optional)" htmlFor="phone">
          <input
            id="phone"
            type="tel"
            placeholder="+1 (555) 123-4567"
            className={inputClass}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Shown at the top of your storefront so customers can reach you.
          </p>
        </Field>

        {!isEditing && (
          <div className="flex items-start gap-3 pt-2">
            <input
              id="terms"
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 h-5 w-5 flex-shrink-0 rounded border-border"
            />
            <label htmlFor="terms" className="text-sm leading-relaxed text-muted-foreground">
              I have read and accept Vendylio&apos;s{' '}
              <button
                type="button"
                onClick={() => setShowTerms(true)}
                className="font-medium text-primary underline"
              >
                Terms &amp; Conditions
              </button>
              .
            </label>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-4">
          <Button
            type="submit"
            disabled={submitting || (!isEditing && !termsAccepted)}
            className="flex-1 sm:flex-none sm:px-10"
          >
            {submitting ? 'Saving…' : isEditing ? 'Save & Continue' : 'Create My Store'}
          </Button>
        </div>
      </div>

      {showTerms && <TermsModal onClose={() => setShowTerms(false)} />}
    </form>
  );
}
