import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LEGAL_SLUGS,
  LEGAL_DEFAULTS,
  TERMS_VERSION,
  TERMS_LAST_UPDATED,
  isLegalSlug,
} from './defaults';

const SRC = resolve(__dirname, '../..');

describe('legal defaults', () => {
  it('every slug has a non-empty Markdown body and a dated version', () => {
    for (const slug of LEGAL_SLUGS) {
      const def = LEGAL_DEFAULTS[slug];
      expect(def.title.length).toBeGreaterThan(3);
      expect(def.body.trim().length).toBeGreaterThan(100);
      expect(def.body).toContain('## ');
      expect(def.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof def.lastUpdated).toBe('string');
    }
  });

  it('keeps the Terms back-compat exports', () => {
    expect(TERMS_VERSION).toBe(LEGAL_DEFAULTS.terms.version);
    expect(TERMS_VERSION).toBe('2026-08-27');
    expect(TERMS_LAST_UPDATED).toBe(LEGAL_DEFAULTS.terms.lastUpdated);
  });

  it('isLegalSlug gates the allow-list', () => {
    expect(isLegalSlug('terms')).toBe(true);
    expect(isLegalSlug('privacy')).toBe(true);
    expect(isLegalSlug('refund-policy')).toBe(true);
    expect(isLegalSlug('../etc/passwd')).toBe(false);
    expect(isLegalSlug('')).toBe(false);
  });
});

describe('legal pages are DB-backed and share one renderer', () => {
  it.each(['terms', 'privacy', 'refund-policy'])(
    'the /%s page reads getLegalDocument + renders LegalMarkdown',
    (slug) => {
      const page = readFileSync(resolve(SRC, `app/${slug}/page.tsx`), 'utf8');
      expect(page).toContain('getLegalDocument');
      expect(page).toContain('LegalMarkdown');
    },
  );

  it('the onboarding Terms modal renders LegalMarkdown from the live endpoint', () => {
    const modal = readFileSync(resolve(SRC, 'components/legal/TermsModal.tsx'), 'utf8');
    expect(modal).toContain('LegalMarkdown');
    expect(modal).toContain('/api/legal/terms');
  });

  it('POST /api/stores stamps the server-side Terms version, not a client value', () => {
    const route = readFileSync(resolve(SRC, 'app/api/stores/route.ts'), 'utf8');
    expect(route).toContain('termsAcceptedAt');
    expect(route).toContain("getLegalDocument('terms')");
    expect(route).not.toContain('termsVersion: termsVersion');
  });
});
