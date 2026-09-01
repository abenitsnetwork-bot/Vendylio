import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/team/owner-guard', () => ({ requireStoreOwner: vi.fn(async () => null) }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));

const vercel = vi.hoisted(() => ({
  isDomainConfigured: vi.fn(() => true),
  addDomainToProject: vi.fn(),
  removeDomainFromProject: vi.fn(async () => {}),
  getDomainState: vi.fn(),
  VercelApiError: class extends Error {},
}));
vi.mock('@/lib/server/domains/vercel', () => vercel);

import { requireAuth } from '@/lib/server/middleware';
import { requireStoreOwner } from '@/lib/server/team/owner-guard';
import { resolveOwnStore } from '@/lib/server/org';
import { GET, POST, DELETE } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockOwner = vi.mocked(requireStoreOwner);
const mockStore = vi.mocked(resolveOwnStore);

function req(method: 'GET' | 'POST' | 'DELETE', body?: unknown) {
  return new NextRequest('http://test/api/stores/domain', {
    method,
    headers: { 'content-type': 'application/json', 'x-csrf-token': 't', cookie: 'app-csrf=t' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const PRO_STORE = {
  id: 's1',
  organizationId: 'org1',
  plan: 'PRO',
  slug: 'shea',
  customDomain: null,
  customDomainStatus: 'NONE',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { sub: 'u1', email: 'o@x.com' } });
  mockOwner.mockResolvedValue(null);
  mockStore.mockResolvedValue({ ...PRO_STORE } as never);
  vercel.isDomainConfigured.mockReturnValue(true);
  vercel.addDomainToProject.mockResolvedValue({
    domain: 'shop.brand.com',
    verified: false,
    misconfigured: true,
    records: [{ type: 'CNAME', name: 'shop', value: 'cname.vercel-dns.com' }],
  });
  prismaMock.store.update.mockResolvedValue({} as never);
});

describe('guards', () => {
  it('402 for a Free store', async () => {
    mockStore.mockResolvedValueOnce({ ...PRO_STORE, plan: 'FREE' } as never);
    expect((await POST(req('POST', { domain: 'shop.brand.com' }))).status).toBe(402);
  });

  it('403 for a non-owner teammate', async () => {
    mockOwner.mockResolvedValueOnce(NextResponse.json({ error: 'OWNER_ONLY' }, { status: 403 }));
    expect((await POST(req('POST', { domain: 'shop.brand.com' }))).status).toBe(403);
  });

  it('503 when Vercel is not configured', async () => {
    vercel.isDomainConfigured.mockReturnValue(false);
    const res = await GET(req('GET'));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('DOMAIN_NOT_CONFIGURED');
  });
});

describe('POST', () => {
  it('rejects an invalid hostname', async () => {
    expect((await POST(req('POST', { domain: 'not a domain' }))).status).toBe(400);
  });

  it('adds the domain + stores PENDING + returns DNS records', async () => {
    const res = await POST(req('POST', { domain: 'Shop.Brand.com' }));
    expect(res.status).toBe(201);
    expect(vercel.addDomainToProject).toHaveBeenCalledWith('shop.brand.com');
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { customDomain: 'shop.brand.com', customDomainStatus: 'PENDING' },
    });
    const body = await res.json();
    expect(body.status).toBe('PENDING');
    expect(body.records[0].type).toBe('CNAME');
  });

  it('409 DOMAIN_TAKEN on a unique-constraint clash', async () => {
    const { Prisma } = await import('@prisma/client');
    prismaMock.store.update.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    const res = await POST(req('POST', { domain: 'shop.brand.com' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('DOMAIN_TAKEN');
    expect(vercel.removeDomainFromProject).toHaveBeenCalledWith('shop.brand.com');
  });
});

describe('GET', () => {
  it('promotes PENDING → ACTIVE once verified', async () => {
    mockStore.mockResolvedValue({
      ...PRO_STORE,
      customDomain: 'shop.brand.com',
      customDomainStatus: 'PENDING',
    } as never);
    vercel.getDomainState.mockResolvedValueOnce({
      domain: 'shop.brand.com',
      verified: true,
      misconfigured: false,
      records: [],
    });
    const res = await GET(req('GET'));
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { customDomainStatus: 'ACTIVE' },
    });
    expect((await res.json()).status).toBe('ACTIVE');
  });
});

describe('DELETE', () => {
  it('detaches + clears the columns', async () => {
    mockStore.mockResolvedValue({
      ...PRO_STORE,
      customDomain: 'shop.brand.com',
      customDomainStatus: 'ACTIVE',
    } as never);
    const res = await DELETE(req('DELETE'));
    expect(res.status).toBe(200);
    expect(vercel.removeDomainFromProject).toHaveBeenCalledWith('shop.brand.com');
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { customDomain: null, customDomainStatus: 'NONE' },
    });
  });
});
