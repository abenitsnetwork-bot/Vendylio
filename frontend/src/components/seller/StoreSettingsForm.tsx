'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { ImageDropzone } from '@/components/ui/ImageDropzone';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';
import { STORE_TEMPLATES, type StoreTemplate } from '@/lib/storeTemplates';
import type { DashboardStore } from '@/components/seller/SellerDashboard';

interface StoreDetails extends DashboardStore {
  description: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  phone: string | null;
  cashAppCashtag: string | null;
  zelleContact: string | null;
  template: StoreTemplate;
  defaultLowStockThreshold: number;
}

/** Tiny CSS mockup of each layout's shape — not a live render, just enough
 * for a seller to tell grid vs. list vs. big-imagery apart at a glance. */
function TemplatePreview({ template }: { template: StoreTemplate }) {
  if (template === 'MINIMAL') {
    return (
      <div className="space-y-1.5 rounded bg-background p-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full bg-muted" />
            <div className="h-1.5 flex-1 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }
  if (template === 'BOLD') {
    return (
      <div className="grid grid-cols-2 gap-1.5 rounded bg-background p-3">
        <div className="h-10 rounded bg-primary" />
        <div className="h-10 rounded bg-muted" />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-1.5 rounded bg-background p-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-8 rounded bg-muted" />
      ))}
    </div>
  );
}

export function StoreSettingsForm({
  store,
  onSaved,
}: {
  store: StoreDetails;
  onSaved: (store: StoreDetails) => void;
}) {
  const [name, setName] = useState(store.name);
  const [description, setDescription] = useState(store.description ?? '');
  const [city, setCity] = useState(store.city ?? '');
  const [state, setState] = useState(store.state ?? '');
  const [phone, setPhone] = useState(store.phone ?? '');
  const [cashAppCashtag, setCashAppCashtag] = useState(store.cashAppCashtag ?? '');
  const [zelleContact, setZelleContact] = useState(store.zelleContact ?? '');
  const [logoUrl, setLogoUrl] = useState<string | null>(store.logoUrl);
  const [template, setTemplate] = useState<StoreTemplate>(store.template);
  const [defaultLowStockThreshold, setDefaultLowStockThreshold] = useState(
    String(store.defaultLowStockThreshold ?? 3),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const isDirty =
    name !== store.name ||
    description !== (store.description ?? '') ||
    city !== (store.city ?? '') ||
    state !== (store.state ?? '') ||
    phone !== (store.phone ?? '') ||
    cashAppCashtag.trim().replace(/^\$/, '') !== (store.cashAppCashtag ?? '') ||
    zelleContact !== (store.zelleContact ?? '') ||
    logoUrl !== store.logoUrl ||
    template !== store.template ||
    Number(defaultLowStockThreshold) !== (store.defaultLowStockThreshold ?? 3);

  useEffect(() => {
    if (!isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const storeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/s/${store.slug}`
      : `/s/${store.slug}`;

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(storeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the link is already visible on screen.
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      const res = await api<{ store: StoreDetails }>('/api/stores', {
        method: 'PATCH',
        body: {
          name,
          description,
          city,
          state,
          phone,
          cashAppCashtag: cashAppCashtag.trim().replace(/^\$/, ''),
          zelleContact,
          logoUrl,
          template,
          defaultLowStockThreshold: Math.max(0, Math.trunc(Number(defaultLowStockThreshold) || 0)),
        },
      });
      onSaved(res.store);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <Card className="p-8">
        <div className="mb-6 flex items-center gap-3 border-b border-border pb-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary">
            <span className="text-sm">🏬</span>
          </div>
          <h2 className="font-headings text-lg font-bold text-foreground">Store Basics</h2>
        </div>
        <div className="space-y-6">
          <Field label="Store Name" htmlFor="storeName">
            <input
              id="storeName"
              className={inputClass}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Store Description" htmlFor="storeDescription">
            <textarea
              id="storeDescription"
              className={`${inputClass} min-h-20`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
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
          <Field label="Phone Number" htmlFor="phone">
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
          <Field label="Store Logo or Photo" htmlFor="logo">
            <ImageDropzone
              label="Click to upload or drag and drop"
              hint="PNG, JPG up to 5MB"
              value={logoUrl}
              onUploaded={setLogoUrl}
              onRemove={() => setLogoUrl(null)}
            />
          </Field>
          <Field label="Default low-stock alert threshold" htmlFor="defaultLowStockThreshold">
            <input
              id="defaultLowStockThreshold"
              type="number"
              min="0"
              step="1"
              className={inputClass}
              value={defaultLowStockThreshold}
              onChange={(e) => setDefaultLowStockThreshold(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              You&apos;ll be warned when a product drops to this many left. Individual products can
              override this in their own settings.
            </p>
          </Field>
        </div>
      </Card>

      <Card className="p-8">
        <div className="mb-6 border-b border-border pb-6">
          <h2 className="font-headings text-lg font-bold text-foreground">
            Manual Payment Methods
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Neither Cash App nor Zelle has an API to confirm a payment automatically — a buyer who
            picks one of these at checkout pays you directly, and you confirm receipt from the
            order&apos;s page once you see it land in your app.
          </p>
        </div>
        <div className="space-y-6">
          <Field label="Cash App Cashtag" htmlFor="cashAppCashtag">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted-foreground">
                $
              </span>
              <input
                id="cashAppCashtag"
                placeholder="AdaezeShop"
                className={`${inputClass} pl-7`}
                value={cashAppCashtag}
                onChange={(e) => setCashAppCashtag(e.target.value)}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Buyers get a QR code that opens Cash App with your total pre-filled. Leave empty to
              hide this option at checkout.
            </p>
          </Field>
          <Field label="Zelle Contact" htmlFor="zelleContact">
            <input
              id="zelleContact"
              placeholder="you@example.com or (555) 123-4567"
              className={inputClass}
              value={zelleContact}
              onChange={(e) => setZelleContact(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              The email or phone number registered with your Zelle account. Leave empty to hide this
              option at checkout.
            </p>
          </Field>
        </div>
      </Card>

      <Card className="p-8">
        <div className="mb-6 border-b border-border pb-6">
          <h2 className="font-headings text-lg font-bold text-foreground">Storefront Template</h2>
        </div>
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
              <TemplatePreview template={t.value} />
              <p className="mt-3 text-sm font-semibold text-foreground">{t.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-8">
        <div className="mb-6 border-b border-border pb-6">
          <h2 className="font-headings text-lg font-bold text-foreground">Preview & Share</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This is the real, live link customers use to shop with you.
          </p>
        </div>
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your store link
            </p>
            <p className="break-all rounded-lg border border-border bg-background px-4 py-3 font-mono text-sm text-foreground">
              {storeUrl}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={`/s/${store.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              <Icon i="store" size={16} />
              View My Store
            </a>
            <button
              type="button"
              onClick={onCopyLink}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary"
            >
              <Icon i="clipboard" size={16} />
              {copied ? 'Copied!' : 'Copy Store Link'}
            </button>
          </div>
        </div>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save Changes'}
        </Button>
        {saved && <span className="text-sm text-green-600">Saved.</span>}
      </div>
    </form>
  );
}
