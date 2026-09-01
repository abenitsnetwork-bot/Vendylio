import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const ipCheck = vi.fn(async () => null as NextResponse | null);
vi.mock('@/lib/server/middleware/rate-limit-by-ip', () => ({
  storefrontViewIpLimiter: { check: (...a: unknown[]) => ipCheck(...(a as [])) },
}));
vi.mock('@/lib/server/middleware', () => ({ optionalAuth: vi.fn(async () => null) }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn(async () => null) }));

const recordView = vi.fn(async () => {});
vi.mock('@/lib/server/analytics/aggregate', () => ({
  recordStorefrontView: (...a: unknown[]) => recordView(...(a as [])),
}));

import { optionalAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { POST } from './route';

const mockOptionalAuth = vi.mocked(optionalAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);

function req(body: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers['cookie'] = cookie;
  return new NextRequest('http://test/api/track', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ipCheck.mockResolvedValue(null);
  mockOptionalAuth.mockResolvedValue(null);
  mockResolveOwnStore.mockResolvedValue(null);
  prismaMock.store.findFirst.mockResolvedValue({
    id: 's1',
    timezone: 'UTC',
    organizationId: 'org1',
  } as never);
});

describe('POST /api/track', () => {
  it('records a STORE view and sets the vnd_vid cookie for a new visitor', async () => {
    const res = await POST(req({ slug: 'shop', kind: 'STORE' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('vnd_vid=');
    expect(recordView).toHaveBeenCalledTimes(1);
    expect((recordView.mock.calls[0] as unknown[])?.[1]).toMatchObject({
      storeId: 's1',
      kind: 'STORE',
      newVisitor: true,
    });
  });

  it('does not re-set the cookie for a returning visitor and marks newVisitor false', async () => {
    const res = await POST(req({ slug: 'shop', kind: 'STORE' }, 'vnd_vid=abc'));
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((recordView.mock.calls[0] as unknown[])?.[1]).toMatchObject({ newVisitor: false });
  });

  it('ignores an unknown / unpublished store', async () => {
    prismaMock.store.findFirst.mockResolvedValueOnce(null);
    const res = await POST(req({ slug: 'ghost', kind: 'STORE' }));
    expect(res.status).toBe(204);
    expect(recordView).not.toHaveBeenCalled();
  });

  it('does not count the store owner previewing', async () => {
    mockOptionalAuth.mockResolvedValueOnce({ user: { sub: 'u1', email: 'o@x.com' } });
    mockResolveOwnStore.mockResolvedValueOnce({ id: 's1' } as never);
    const res = await POST(req({ slug: 'shop', kind: 'STORE' }));
    expect(res.status).toBe(204);
    expect(recordView).not.toHaveBeenCalled();
  });

  it('passes through the IP limiter response', async () => {
    ipCheck.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await POST(req({ slug: 'shop', kind: 'STORE' }));
    expect(res.status).toBe(429);
    expect(recordView).not.toHaveBeenCalled();
  });

  it('still 204s on a malformed body (beacon never reads it)', async () => {
    const res = await POST(req({ nope: true }));
    expect(res.status).toBe(204);
    expect(recordView).not.toHaveBeenCalled();
  });
});
