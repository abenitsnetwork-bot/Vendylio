import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const ipCheck = vi.fn(async () => null as NextResponse | null);
vi.mock('@/lib/server/middleware/rate-limit-by-ip', () => ({
  contactIpLimiter: { check: (...a: unknown[]) => ipCheck(...(a as [])) },
}));
vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));

import { POST } from './route';

function req(body: unknown) {
  return new NextRequest('http://test/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ipCheck.mockResolvedValue(null);
  prismaMock.contactMessage.create.mockResolvedValue({} as never);
});

describe('POST /api/contact', () => {
  it('201 creates a message', async () => {
    const res = await POST(
      req({ name: 'Jane Doe', email: 'Jane@Example.com', topic: 'Sales', message: 'Hi there' }),
    );
    expect(res.status).toBe(201);
    expect(prismaMock.contactMessage.create).toHaveBeenCalledWith({
      data: { name: 'Jane Doe', email: 'jane@example.com', topic: 'Sales', message: 'Hi there' },
    });
  });

  it('creates a message without a topic', async () => {
    const res = await POST(req({ name: 'Jane', email: 'jane@example.com', message: 'Hi' }));
    expect(res.status).toBe(201);
    expect(prismaMock.contactMessage.create).toHaveBeenCalledWith({
      data: { name: 'Jane', email: 'jane@example.com', message: 'Hi' },
    });
  });

  it('400 on a bad email', async () => {
    const res = await POST(req({ name: 'Jane', email: 'nope', message: 'Hi' }));
    expect(res.status).toBe(400);
  });

  it('400 on an empty message', async () => {
    const res = await POST(req({ name: 'Jane', email: 'jane@example.com', message: '' }));
    expect(res.status).toBe(400);
  });

  it('passes through the IP limiter', async () => {
    ipCheck.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await POST(req({ name: 'Jane', email: 'jane@example.com', message: 'Hi' }));
    expect(res.status).toBe(429);
    expect(prismaMock.contactMessage.create).not.toHaveBeenCalled();
  });
});
