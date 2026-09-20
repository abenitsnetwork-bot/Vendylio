// Tests for POST /api/admin/upload-video — SUPERADMIN-only video upload.
// Mirrors src/app/api/upload/route.test.ts's mock strategy (Cloudinary
// stubbed via cloudinary-mock.ts) but gates on requireSuperadmin + the admin
// rate limiter instead of requireAuth.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextResponse } from 'next/server';
import { mockCloudinaryClient } from '@/test-utils/cloudinary-mock';
import { seedSuperadmin } from '@/test-utils/admin-fixtures';

const cl = mockCloudinaryClient();

vi.mock('@/lib/server/upload/cloudinary-client', () => ({
  uploadBuffer: vi.fn((publicId: string, body: Buffer) => cl.uploadBuffer(publicId, body)),
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

const prismaCreate = vi.fn(async (args: unknown) => ({
  id: 'fu-1',
  key: (args as { data: { key: string } }).data.key,
  filename: 'clip.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 4,
}));
vi.mock('@/lib/server/prisma', () => ({
  prisma: { fileUpload: { create: prismaCreate } },
}));

import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { verifyCsrf } from '@/lib/server/auth';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockVerifyCsrf = vi.mocked(verifyCsrf);

const actor = seedSuperadmin({ id: 'superadmin_1' });
const actorCtx = {
  user: { sub: actor.id, email: actor.email },
  admin: { id: actor.id, email: actor.email, role: 'SUPERADMIN' as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx as never);
  mockRateLimit.mockResolvedValue(null);
  mockVerifyCsrf.mockReturnValue(null);
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'test-cloud');
  vi.stubEnv('CLOUDINARY_API_KEY', 'test-key');
  vi.stubEnv('CLOUDINARY_API_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const MP4_BYTES = new Uint8Array([
  0x00,
  0x00,
  0x00,
  0x18,
  0x66,
  0x74,
  0x79,
  0x70,
  0x69,
  0x73,
  0x6f,
  0x6d, // ftyp isom
]);
const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

function makeReq(file: File | null, csrf = true) {
  const fd = new FormData();
  if (file) fd.append('file', file);
  const headers = new Headers();
  if (csrf) headers.set('x-csrf-token', 'test-csrf');
  return new Request(new URL('http://localhost/api/admin/upload-video'), {
    method: 'POST',
    body: fd,
    headers,
  });
}

describe('POST /api/admin/upload-video', () => {
  it('valid mp4 uploads', async () => {
    const { POST } = await import('./route');
    const file = new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' });
    const res = await POST(makeReq(file) as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toMatch(/^https:\/\/res\.cloudinary\.com\//);
    expect(prismaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: actor.id, mimeType: 'video/mp4' }),
      }),
    );
  });

  it('valid webm uploads', async () => {
    const { POST } = await import('./route');
    const file = new File([WEBM_BYTES], 'clip.webm', { type: 'video/webm' });
    const res = await POST(makeReq(file) as never);
    expect(res.status).toBe(201);
  });

  it('magic byte mismatch', async () => {
    const { POST } = await import('./route');
    const fake = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'clip.mp4', {
      type: 'video/mp4',
    });
    const res = await POST(makeReq(fake) as never);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.code).toBe('MAGIC_BYTE_MISMATCH');
  });

  it('mime not allowed (image rejected)', async () => {
    const { POST } = await import('./route');
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', { type: 'image/jpeg' });
    const res = await POST(makeReq(file) as never);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.code).toBe('INVALID_MIME');
  });

  it('file too large', async () => {
    vi.stubEnv('UPLOAD_VIDEO_MAX_BYTES', '10');
    const { POST } = await import('./route');
    const big = new File([new Uint8Array(50)], 'big.mp4', { type: 'video/mp4' });
    const res = await POST(makeReq(big) as never);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('FILE_TOO_LARGE');
  });

  it('storage not configured (env missing)', async () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', '');
    const { POST } = await import('./route');
    const file = new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' });
    const res = await POST(makeReq(file) as never);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('STORAGE_NOT_CONFIGURED');
  });

  it('missing file', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeReq(null) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UPLOAD_MISSING_FILE');
  });

  it('403s when CSRF fails', async () => {
    mockVerifyCsrf.mockReturnValueOnce(NextResponse.json({}, { status: 403 }));
    const { POST } = await import('./route');
    const file = new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' });
    const res = await POST(makeReq(file, false) as never);
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('propagates 403 from requireSuperadmin (plain ADMIN cannot upload)', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'SUPERADMIN_REQUIRED' }, { status: 403 }),
    );
    const { POST } = await import('./route');
    const file = new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' });
    const res = await POST(makeReq(file) as never);
    expect(res.status).toBe(403);
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
    const { POST } = await import('./route');
    const file = new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' });
    const res = await POST(makeReq(file) as never);
    expect(res.status).toBe(429);
  });

  it('upload failed (cloudinary throws)', async () => {
    const { uploadBuffer } = await import('@/lib/server/upload/cloudinary-client');
    (uploadBuffer as unknown as Mock).mockImplementationOnce(async () => {
      throw new Error('Cloudinary down');
    });
    const { POST } = await import('./route');
    const file = new File([MP4_BYTES], 'clip.mp4', { type: 'video/mp4' });
    const res = await POST(makeReq(file) as never);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('UPLOAD_FAILED');
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
