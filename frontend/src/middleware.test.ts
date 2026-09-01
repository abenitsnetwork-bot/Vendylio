import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
// middleware.ts lives at the package root (frontend/), one level above src/.
import { middleware } from '../middleware';

// Default host is one of our own (localhost) so the custom-domain rewrite is
// inert for these; the custom-domain tests pass an explicit foreign host.
function request(
  path: string,
  cookies: Record<string, string> = {},
  host = 'localhost:3000',
): NextRequest {
  const req = new NextRequest(new URL(`https://${host.split(':')[0]}${path}`), {
    headers: { host },
  });
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

const ACCESS = 'app-token';
const REFRESH = 'app-refresh';

// NextResponse.next() carries this header; a plain rewrite/redirect does not.
const isNext = (res: Response) => res.headers.get('x-middleware-next') === '1';
const rewriteTarget = (res: Response) => res.headers.get('x-middleware-rewrite');

describe('/admin edge pre-filter', () => {
  it('404s an anonymous request to /admin (no shell served)', () => {
    const res = middleware(request('/admin'));
    expect(res.status).toBe(404);
    expect(isNext(res)).toBe(false);
  });

  it('404s an anonymous request to a deep /admin/* path', () => {
    expect(middleware(request('/admin/users/abc123')).status).toBe(404);
  });

  it('lets a request with an access cookie through to the server gate', () => {
    const res = middleware(request('/admin', { [ACCESS]: 'jwt' }));
    expect(isNext(res)).toBe(true);
  });

  it('bounces a refresh-only session through silent refresh', () => {
    const res = middleware(request('/admin/orders', { [REFRESH]: 'rjwt' }));
    expect(res.status).toBe(303);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/api/auth/refresh-and-return');
    expect(location).toContain('next=%2Fadmin%2Forders');
  });

  it('does not treat /administrators as an admin path', () => {
    expect(isNext(middleware(request('/administrators')))).toBe(true);
  });
});

describe('non-admin paths are unaffected', () => {
  it('passes through when AUTH_PROTECTED_PREFIXES is unset', () => {
    expect(isNext(middleware(request('/dashboard')))).toBe(true);
    expect(isNext(middleware(request('/')))).toBe(true);
  });
});

describe('custom domain rewrite (Phase 4b)', () => {
  it('rewrites the root of a foreign host to /s/<host>', () => {
    const res = middleware(request('/', {}, 'shop.brand.com'));
    expect(rewriteTarget(res)).toContain('/s/shop.brand.com');
  });

  it('rewrites storefront sub-paths, preserving the path', () => {
    expect(rewriteTarget(middleware(request('/products/abc', {}, 'shop.brand.com')))).toContain(
      '/s/shop.brand.com/products/abc',
    );
    expect(rewriteTarget(middleware(request('/checkout', {}, 'shop.brand.com')))).toContain(
      '/s/shop.brand.com/checkout',
    );
  });

  it('does not rewrite (or expose) /dashboard on a foreign host', () => {
    const res = middleware(request('/dashboard', {}, 'shop.brand.com'));
    expect(rewriteTarget(res)).toBeNull();
    expect(isNext(res)).toBe(true);
  });

  it('leaves our own hosts alone', () => {
    expect(rewriteTarget(middleware(request('/', {}, 'localhost:3000')))).toBeNull();
    expect(rewriteTarget(middleware(request('/', {}, 'app.vercel.app')))).toBeNull();
  });
});
