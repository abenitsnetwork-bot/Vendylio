import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import robots from './robots';

beforeEach(() => vi.stubEnv('APP_URL', 'https://vendylio.example'));
afterEach(() => vi.unstubAllEnvs());

describe('robots()', () => {
  it('allows crawling of the root and disallows auth/private/api trees', () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    expect(rule.allow).toBe('/');
    expect(rule.disallow).toEqual(
      expect.arrayContaining(['/api/', '/dashboard/', '/admin/', '/onboarding/']),
    );
  });

  it('points at the absolute sitemap URL', () => {
    expect(robots().sitemap).toBe('https://vendylio.example/sitemap.xml');
  });

  it('does not disallow the public storefront path', () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    const disallow = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow];
    expect(disallow).not.toContain('/s/');
  });
});
