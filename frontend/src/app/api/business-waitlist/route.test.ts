import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const ipCheck = vi.fn(async () => null as NextResponse | null);
vi.mock('@/lib/server/middleware/rate-limit-by-ip', () => ({
  leadIpLimiter: { check: (...a: unknown[]) => ipCheck(...(a as [])) },
}));
vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));

import { POST } from './route';

function req(body: unknown) {
  return new NextRequest('http://test/api/business-waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ipCheck.mockResolvedValue(null);
  prismaMock.businessLead.create.mockResolvedValue({} as never);
});

describe('POST /api/business-waitlist', () => {
  it('201 creates a lead', async () => {
    const res = await POST(req({ email: 'Founder@Biz.com', storeName: 'Biz' }));
    expect(res.status).toBe(201);
    expect(prismaMock.businessLead.create).toHaveBeenCalledWith({
      data: { email: 'founder@biz.com', storeName: 'Biz' },
    });
  });

  it('400 on a bad email', async () => {
    expect((await POST(req({ email: 'nope' }))).status).toBe(400);
  });

  it('200 (not an error) when the email is already listed', async () => {
    const { Prisma } = await import('@prisma/client');
    prismaMock.businessLead.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    const res = await POST(req({ email: 'founder@biz.com' }));
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyListed).toBe(true);
  });

  it('passes through the IP limiter', async () => {
    ipCheck.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    expect((await POST(req({ email: 'x@y.com' }))).status).toBe(429);
    expect(prismaMock.businessLead.create).not.toHaveBeenCalled();
  });
});
