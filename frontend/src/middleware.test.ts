import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
// middleware.ts lives at the package root (frontend/), one level above src/.
import { middleware } from '../middleware';

function request(path: string, cookies: Record<string, string> = {}): NextRequest {
  const req = new NextRequest(new URL(`https://shop.test${path}`));
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}

const ACCESS = 'app-token';
const REFRESH = 'app-refresh';

// NextResponse.next() carries this header; a plain rewrite/redirect does not.
const isNext = (res: Response) => res.headers.get('x-middleware-next') === '1';

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
