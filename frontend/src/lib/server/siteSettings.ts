import 'server-only';
import { prisma } from '@/lib/server/prisma';

const SETTINGS_ID = 'default';

export interface SiteSettingsData {
  location: string;
  contactEmail: string;
  websiteUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
  tiktokUrl: string | null;
  linkedinUrl: string | null;
}

// Bundled defaults — a fresh install (or before a SUPERADMIN has ever saved
// the Contact & Company Info form) shows these instead of a blank line.
const DEFAULTS: SiteSettingsData = {
  location: 'Phoenix, Arizona, USA',
  contactEmail: 'no-reply@vendylio.com',
  websiteUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  twitterUrl: null,
  tiktokUrl: null,
  linkedinUrl: null,
};

/**
 * Public, unauthenticated read — the contact page and marketing footer both
 * call this. Any field left unset by the admin falls back to the bundled
 * default above rather than rendering empty.
 */
export async function getSiteSettings(): Promise<SiteSettingsData> {
  const row = await prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!row) return DEFAULTS;
  return {
    location: row.location || DEFAULTS.location,
    contactEmail: row.contactEmail || DEFAULTS.contactEmail,
    websiteUrl: row.websiteUrl || DEFAULTS.websiteUrl,
    instagramUrl: row.instagramUrl || DEFAULTS.instagramUrl,
    facebookUrl: row.facebookUrl || DEFAULTS.facebookUrl,
    twitterUrl: row.twitterUrl || DEFAULTS.twitterUrl,
    tiktokUrl: row.tiktokUrl || DEFAULTS.tiktokUrl,
    linkedinUrl: row.linkedinUrl || DEFAULTS.linkedinUrl,
  };
}
