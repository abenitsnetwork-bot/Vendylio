// Tests for POST /api/admin/upload-video/sign — SUPERADMIN-only Cloudinary
// direct-upload signing. No bytes flow through this route; it just mints a
// signature, so the mock surface is small compared to a real upload route.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { seedSuperadmin } from '@/test-utils/admin-fixtures';

vi.mock('@/lib/server/upload/cloudinary-client', () => ({
  signVideoUpload: vi.fn(),
  StorageNotConfiguredError: class StorageNotConfiguredError extends Error {
    constructor() {
      super('Storage not configured');
      this.name = 'StorageNotConfiguredError';
    }
  },
}));
vi.mock('@/lib/server/middleware', () => ({
  requireSuperadmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/auth', () => ({
  verifyCsrf: vi.fn(() => null),
}));

import { signVideoUpload, StorageNotConfiguredError } from '@/lib/server/upload/cloudinary-client';
import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { verifyCsrf } from '@/lib/server/auth';

const mockSign = vi.mocked(signVideoUpload);
const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockVerifyCsrf = vi.mocked(verifyCsrf);

const actor = seedSuperadmin({ id: 'superadmin_1' });
const actorCtx = {
  user: { sub: actor.id, email: actor.email },
  admin: { id: actor.id, email: actor.email, role: 'SUPERADMIN' as const },
};

function makeReq(csrf = true) {
  const headers = new Headers();
  if (csrf) headers.set('x-csrf-token', 'test-csrf');
  return new Request(new URL('http://localhost/api/admin/upload-video/sign'), {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx as never);
  mockRateLimit.mockResolvedValue(null);
  mockVerifyCsrf.mockReturnValue(null);
  mockSign.mockReturnValue({
    cloudName: 'test-cloud',
    apiKey: 'test-key',
    timestamp: 1700000000,
    signature: 'abc123',
    publicId: `site-videos/${actor.id}/uuid`,
    uploadUrl: 'https://api.cloudinary.com/v1_1/test-cloud/video/upload',
  });
});

describe('POST /api/admin/upload-video/sign', () => {
  it('returns a signed upload payload', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toBe('https://api.cloudinary.com/v1_1/test-cloud/video/upload');
    expect(body.signature).toBe('abc123');
    expect(body.publicId).toContain(actor.id);
  });

  it('403s when CSRF fails', async () => {
    mockVerifyCsrf.mockReturnValueOnce(NextResponse.json({}, { status: 403 }));
    const { POST } = await import('./route');
    const res = await POST(makeReq(false) as never);
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('propagates 403 from requireSuperadmin (plain ADMIN cannot sign)', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'SUPERADMIN_REQUIRED' }, { status: 403 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(403);
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(429);
  });

  it('503s STORAGE_NOT_CONFIGURED when Cloudinary env is missing', async () => {
    mockSign.mockImplementationOnce(() => {
      throw new StorageNotConfiguredError();
    });
    const { POST } = await import('./route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('STORAGE_NOT_CONFIGURED');
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
