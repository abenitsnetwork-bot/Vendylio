import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { LEGAL_DEFAULTS, type LegalSlug } from '@/lib/legal/defaults';

export interface ResolvedLegalDocument {
  slug: LegalSlug;
  title: string;
  body: string;
  version: string;
  /** Human date for the "Last updated: …" line. */
  lastUpdated: string;
  /** True when no edited row exists yet — the bundled default is being served. */
  isDefault: boolean;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Reads the live legal document for `slug`, falling back to the bundled
// default in lib/legal/defaults.ts when a SUPERADMIN has never edited it.
// Used by the public /terms, /privacy, /refund-policy pages, the
// GET /api/legal/[slug] endpoint (onboarding Terms modal), the admin editor,
// and POST /api/stores (Terms version snapshot).
export async function getLegalDocument(slug: LegalSlug): Promise<ResolvedLegalDocument> {
  const fallback = LEGAL_DEFAULTS[slug];
  const row = await prisma.legalDocument.findUnique({ where: { slug } });

  if (!row) {
    return {
      slug,
      title: fallback.title,
      body: fallback.body,
      version: fallback.version,
      lastUpdated: fallback.lastUpdated,
      isDefault: true,
    };
  }

  return {
    slug,
    title: fallback.title,
    body: row.body,
    version: row.version,
    lastUpdated: formatDate(row.updatedAt),
    isDefault: false,
  };
}
