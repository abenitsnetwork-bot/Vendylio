import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect } from 'vitest';
import { getSiteSettings } from './siteSettings';

describe('getSiteSettings', () => {
  it('returns bundled defaults when no row exists', async () => {
    prismaMock.siteSettings.findUnique.mockResolvedValueOnce(null);
    const result = await getSiteSettings();
    expect(result).toEqual({
      location: 'Phoenix, Arizona, USA',
      contactEmail: 'no-reply@vendylio.com',
      websiteUrl: null,
      instagramUrl: null,
      facebookUrl: null,
      twitterUrl: null,
      tiktokUrl: null,
      linkedinUrl: null,
    });
  });

  it('returns stored values when set', async () => {
    prismaMock.siteSettings.findUnique.mockResolvedValueOnce({
      id: 'default',
      location: 'Austin, Texas, USA',
      contactEmail: 'hello@vendylio.com',
      websiteUrl: 'https://vendylio.com',
      instagramUrl: 'https://instagram.com/vendylio',
      facebookUrl: 'https://facebook.com/vendylio',
      twitterUrl: null,
      tiktokUrl: null,
      linkedinUrl: null,
      updatedAt: new Date(),
    } as never);
    const result = await getSiteSettings();
    expect(result).toEqual({
      location: 'Austin, Texas, USA',
      contactEmail: 'hello@vendylio.com',
      websiteUrl: 'https://vendylio.com',
      instagramUrl: 'https://instagram.com/vendylio',
      facebookUrl: 'https://facebook.com/vendylio',
      twitterUrl: null,
      tiktokUrl: null,
      linkedinUrl: null,
    });
  });

  it('falls back to the default per-field when a stored value is null', async () => {
    prismaMock.siteSettings.findUnique.mockResolvedValueOnce({
      id: 'default',
      location: null,
      contactEmail: null,
      websiteUrl: null,
      instagramUrl: null,
      facebookUrl: null,
      twitterUrl: null,
      tiktokUrl: null,
      linkedinUrl: null,
      updatedAt: new Date(),
    } as never);
    const result = await getSiteSettings();
    expect(result.location).toBe('Phoenix, Arizona, USA');
    expect(result.contactEmail).toBe('no-reply@vendylio.com');
  });
});
