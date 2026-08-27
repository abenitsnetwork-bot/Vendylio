'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { ImageDropzone } from '@/components/ui/ImageDropzone';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

interface SiteImageSlot {
  key: string;
  label: string;
  hint: string;
  url: string | null;
  altText: string | null;
}

interface Testimonial {
  id: string;
  name: string;
  location: string | null;
  detail: string | null;
  quote: string;
  avatarUrl: string | null;
  rating: number | null;
  sortOrder: number;
  visible: boolean;
}

function ImageSlotCard({
  slot,
  onSaved,
}: {
  slot: SiteImageSlot;
  onSaved: (updated: SiteImageSlot) => void;
}) {
  const [altText, setAltText] = useState(slot.altText ?? '');
  const [savingAlt, setSavingAlt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function persist(url: string, nextAltText: string) {
    setError(null);
    try {
      const res = await api<{ image: { key: string; url: string; altText: string | null } }>(
        `/api/admin/site-images/${slot.key}`,
        { method: 'PUT', body: { url, altText: nextAltText || null } },
      );
      onSaved({ ...slot, url: res.image.url, altText: res.image.altText });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this image.');
    }
  }

  async function clear() {
    setError(null);
    try {
      await api(`/api/admin/site-images/${slot.key}`, { method: 'DELETE' });
      onSaved({ ...slot, url: null, altText: null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this image.');
    }
  }

  return (
    <Card className="p-5">
      <p className="mb-1 text-sm font-semibold text-foreground">{slot.label}</p>
      <p className="mb-3 text-xs text-muted-foreground">{slot.hint}</p>
      <ImageDropzone
        label="Click to upload or drag and drop"
        hint="PNG, JPG up to 5MB"
        value={slot.url}
        onUploaded={(url) => void persist(url, altText)}
        onRemove={() => void clear()}
      />
      <div className="mt-3 flex items-center gap-2">
        <input
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          placeholder="Alt text (for accessibility)"
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground"
        />
        <button
          type="button"
          disabled={!slot.url || savingAlt}
          onClick={async () => {
            setSavingAlt(true);
            await persist(slot.url!, altText);
            setSavingAlt(false);
          }}
          className="flex-shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
        >
          {savingAlt ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Card>
  );
}

const EMPTY_FORM = { name: '', location: '', detail: '', quote: '', rating: '' };

function TestimonialForm({
  initial,
  onSubmit,
  submitLabel,
}: {
  initial?: Partial<typeof EMPTY_FORM>;
  onSubmit: (data: {
    name: string;
    location: string | null;
    detail: string | null;
    quote: string;
    rating: number | null;
  }) => Promise<void>;
  submitLabel: string;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        name: form.name,
        location: form.location || null,
        detail: form.detail || null,
        quote: form.quote,
        rating: form.rating ? Number(form.rating) : null,
      });
      if (!initial) setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Name" htmlFor="t-name">
          <input
            id="t-name"
            required
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label="Location" htmlFor="t-location">
          <input
            id="t-location"
            className={inputClass}
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          />
        </Field>
        <Field label="Detail (what they sell)" htmlFor="t-detail">
          <input
            id="t-detail"
            className={inputClass}
            value={form.detail}
            onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
          />
        </Field>
      </div>
      <Field label="Quote" htmlFor="t-quote">
        <textarea
          id="t-quote"
          required
          className={`${inputClass} min-h-20`}
          value={form.quote}
          onChange={(e) => setForm((f) => ({ ...f, quote: e.target.value }))}
        />
      </Field>
      <Field label="Rating (1-5, optional)" htmlFor="t-rating">
        <input
          id="t-rating"
          type="number"
          min="1"
          max="5"
          className={`${inputClass} max-w-24`}
          value={form.rating}
          onChange={(e) => setForm((f) => ({ ...f, rating: e.target.value }))}
        />
      </Field>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button type="submit" disabled={submitting} className="px-5 py-2 text-sm">
        {submitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}

function TestimonialRow({
  t,
  onChanged,
  onDeleted,
}: {
  t: Testimonial;
  onChanged: (updated: Testimonial) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [sortOrder, setSortOrder] = useState(String(t.sortOrder));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(data: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ testimonial: Testimonial }>(`/api/admin/testimonials/${t.id}`, {
        method: 'PATCH',
        body: data,
      });
      onChanged(res.testimonial);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete the testimonial from "${t.name}"?`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/testimonials/${t.id}`, { method: 'DELETE' });
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete.');
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <Card className="p-5">
        <TestimonialForm
          initial={{
            name: t.name,
            location: t.location ?? '',
            detail: t.detail ?? '',
            quote: t.quote,
            rating: t.rating ? String(t.rating) : '',
          }}
          submitLabel="Save changes"
          onSubmit={async (data) => {
            await patch(data);
            setEditing(false);
          }}
        />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-3 text-xs font-medium text-muted-foreground"
        >
          Cancel
        </button>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground">&ldquo;{t.quote}&rdquo;</p>
          <p className="mt-2 text-xs font-semibold text-foreground">
            {t.name}
            {t.location ? ` — ${t.location}` : ''}
          </p>
          {t.detail && <p className="text-xs text-muted-foreground">{t.detail}</p>}
        </div>
        {!t.visible && (
          <span className="flex-shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
            Hidden
          </span>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditing(true)}
          className="text-xs font-medium text-primary disabled:opacity-50"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void patch({ visible: !t.visible })}
          className="text-xs font-medium text-primary disabled:opacity-50"
        >
          {t.visible ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={handleDelete}
          className="text-xs font-medium text-red-600 disabled:opacity-50"
        >
          Delete
        </button>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor={`sort-${t.id}`} className="text-xs text-muted-foreground">
            Order
          </label>
          <input
            id={`sort-${t.id}`}
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            onBlur={() => {
              const n = Number(sortOrder);
              if (Number.isFinite(n) && n !== t.sortOrder) void patch({ sortOrder: n });
            }}
            className="w-16 rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground"
          />
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Card>
  );
}

export default function AdminSiteContentPage() {
  const [images, setImages] = useState<SiteImageSlot[] | null>(null);
  const [testimonials, setTestimonials] = useState<Testimonial[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api<{ images: SiteImageSlot[] }>('/api/admin/site-images'),
      api<{ testimonials: Testimonial[] }>('/api/admin/testimonials'),
    ])
      .then(([imgRes, tRes]) => {
        setImages(imgRes.images);
        setTestimonials(tRes.testimonials);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load site content.'),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <h1
        className="mb-2 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
      >
        Landing Page Content
      </h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Photos and seller testimonials shown on the public homepage.
      </p>

      {error && <p className="mb-6 text-sm text-red-600">{error}</p>}

      <section className="mb-12">
        <h2 className="mb-4 font-headings text-lg font-bold text-foreground">Photos</h2>
        {!images && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {images && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((slot) => (
              <ImageSlotCard
                key={slot.key}
                slot={slot}
                onSaved={(updated) =>
                  setImages((prev) => prev!.map((s) => (s.key === slot.key ? updated : s)))
                }
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-headings text-lg font-bold text-foreground">Testimonials</h2>
        {!testimonials && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {testimonials && testimonials.length === 0 && (
          <div className="mb-6 py-8 text-center">
            <Icon
              i="message-circle"
              size={28}
              className="mx-auto mb-3 text-muted-foreground opacity-50"
            />
            <p className="text-sm text-muted-foreground">No testimonials yet.</p>
          </div>
        )}
        {testimonials && testimonials.length > 0 && (
          <div className="mb-8 space-y-3">
            {testimonials.map((t) => (
              <TestimonialRow
                key={t.id}
                t={t}
                onChanged={(updated) =>
                  setTestimonials((prev) => prev!.map((x) => (x.id === t.id ? updated : x)))
                }
                onDeleted={() => setTestimonials((prev) => prev!.filter((x) => x.id !== t.id))}
              />
            ))}
          </div>
        )}

        <Card className="p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">Add a testimonial</h3>
          <TestimonialForm
            submitLabel="Add testimonial"
            onSubmit={async (data) => {
              const res = await api<{ testimonial: Testimonial }>('/api/admin/testimonials', {
                method: 'POST',
                body: data,
              });
              setTestimonials((prev) => [...(prev ?? []), res.testimonial]);
            }}
          />
        </Card>
      </section>
    </div>
  );
}
