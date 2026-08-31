import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TERMS_VERSION, TERMS_LAST_UPDATED } from './terms';

const SRC = resolve(__dirname, '../..');

describe('Terms version wiring', () => {
  it('exports a version + last-updated string', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof TERMS_LAST_UPDATED).toBe('string');
  });

  it('the /terms page and the onboarding gate render the same TermsContent', () => {
    const page = readFileSync(resolve(SRC, 'app/terms/page.tsx'), 'utf8');
    const modal = readFileSync(resolve(SRC, 'components/legal/TermsModal.tsx'), 'utf8');
    expect(page).toContain('TermsContent');
    expect(modal).toContain('TermsContent');
  });

  it('POST /api/stores stamps the accepted Terms version', () => {
    const route = readFileSync(resolve(SRC, 'app/api/stores/route.ts'), 'utf8');
    expect(route).toContain('termsAcceptedAt');
    expect(route).toContain('TERMS_VERSION');
    expect(route).toContain('TERMS_NOT_ACCEPTED');
  });
});
