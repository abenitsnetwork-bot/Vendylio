'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { LegalMarkdown } from '@/components/legal/LegalMarkdown';
import { LEGAL_SLUGS, type LegalSlug } from '@/lib/legal/defaults';

interface AdminLegalDoc {
  slug: LegalSlug;
  title: string;
  body: string;
  version: string;
  lastUpdated: string;
  isDefault: boolean;
}

const TAB_LABELS: Record<LegalSlug, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  'refund-policy': 'Refund Policy',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LegalDocsSection() {
  const [slug, setSlug] = useState<LegalSlug>('terms');
  const [doc, setDoc] = useState<AdminLegalDoc | null>(null);
  const [body, setBody] = useState('');
  const [version, setVersion] = useState('');
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const load = useCallback((which: LegalSlug) => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    api<AdminLegalDoc>(`/api/admin/legal/${which}`)
      .then((res) => {
        setDoc(res);
        setBody(res.body);
        setVersion(res.version);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load this document.'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(slug);
  }, [slug, load]);

  const dirty = doc !== null && (body !== doc.body || version !== doc.version);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await api<AdminLegalDoc>(`/api/admin/legal/${slug}`, {
        method: 'PUT',
        body: { body, version },
      });
      setDoc(res);
      setBody(res.body);
      setVersion(res.version);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this document.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-8 max-w-3xl p-8">
      <h2 className="mb-1 font-headings text-lg font-bold text-foreground">Legal pages</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        The public <span className="font-medium">Terms</span>,{' '}
        <span className="font-medium">Privacy</span> and{' '}
        <span className="font-medium">Refund Policy</span> pages, and the Terms shown during seller
        onboarding. Written in Markdown (<code>## heading</code>, <code>- list</code>,{' '}
        <code>[link](/path)</code>, <code>**bold**</code>). Changes are live on the site
        immediately.
      </p>

      <div className="mb-5 flex flex-wrap gap-2">
        {LEGAL_SLUGS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSlug(s)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              s === slug
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-muted-foreground hover:bg-secondary'
            }`}
          >
            {TAB_LABELS[s]}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && doc && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span
              className={`rounded-full px-2.5 py-1 font-semibold ${
                doc.isDefault ? 'bg-secondary text-muted-foreground' : 'bg-green-100 text-green-700'
              }`}
            >
              {doc.isDefault ? 'Default text — not customized yet' : 'Customized'}
            </span>
            <a
              href={`/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline"
            >
              View public page ↗
            </a>
            <button
              type="button"
              onClick={() => setPreview((p) => !p)}
              className="ml-auto font-medium text-primary"
            >
              {preview ? 'Edit text' : 'Preview'}
            </button>
          </div>

          {preview ? (
            <div className="rounded-lg border border-border bg-background p-6">
              <div className="space-y-6 text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:font-headings [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-foreground [&_li]:text-muted-foreground [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
                <LegalMarkdown source={body} />
              </div>
            </div>
          ) : (
            <Field label="Page content (Markdown)" htmlFor="legal-body">
              <textarea
                id="legal-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                spellCheck={false}
                className={`${inputClass} min-h-[420px] font-mono text-xs leading-relaxed`}
              />
            </Field>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Version" htmlFor="legal-version">
              <input
                id="legal-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className={`${inputClass} max-w-40`}
              />
            </Field>
            <button
              type="button"
              onClick={() => setVersion(today())}
              className="mb-[2px] rounded-lg border border-border px-3 py-3 text-xs font-semibold text-foreground hover:bg-secondary"
            >
              Set to today
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            For the Terms, the version is snapshotted onto every new store at signup — bump it when
            the wording changes materially.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-700">Saved — live on the site now.</p>}

          <Button type="button" onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </Card>
  );
}
