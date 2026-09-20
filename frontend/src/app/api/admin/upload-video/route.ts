/**
 * POST /api/admin/upload-video — SUPERADMIN-only multipart video upload for
 * site content (e.g. the homepage video slot in SiteVideo). Deliberately a
 * separate route from POST /api/upload (image-oriented, UPLOAD_ALLOWED_MIME
 * defaults to jpeg/png/webp, UPLOAD_MAX_BYTES defaults to 10MB — both wrong
 * for video) rather than widening that shared route's defaults for every
 * upload flow in the app.
 *
 * Same pipeline/ordering as /api/upload (D-UP-04): CSRF → auth → storage
 * check → parse → size cap → MIME allowlist → magic-byte sniff → Cloudinary
 * upload_stream → FileUpload row. Mime allowlist and size cap are baked in
 * here (not read from UPLOAD_ALLOWED_MIME/UPLOAD_MAX_BYTES) since this route
 * has its own, video-specific limits.
 */
export const runtime = 'nodejs';

import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { verifyCsrf } from '@/lib/server/auth';
import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { StorageNotConfiguredError, uploadBuffer } from '@/lib/server/upload/cloudinary-client';
import { sanitizeFilename } from '@/lib/server/upload/sanitize-filename';
import { verifyMagicBytes } from '@/lib/server/upload/sniff';

const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024; // 100MB

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return NextResponse.json(
        { code: 'STORAGE_NOT_CONFIGURED', message: 'Storage not configured' },
        { status: 503, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const maxBytes = Number.parseInt(
      process.env.UPLOAD_VIDEO_MAX_BYTES ?? String(DEFAULT_MAX_BYTES),
      10,
    );

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { code: 'UPLOAD_MISSING_FILE', message: 'file field is required' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    if (file.size > maxBytes) {
      return NextResponse.json(
        { code: 'FILE_TOO_LARGE', message: `Max ${maxBytes} bytes` },
        { status: 413, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    if (!ALLOWED_VIDEO_MIME.has(file.type)) {
      return NextResponse.json(
        { code: 'INVALID_MIME', message: `MIME ${file.type} not allowed` },
        { status: 415, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const { match, sniffed } = verifyMagicBytes(buf, file.type);
    if (sniffed && !match) {
      return NextResponse.json(
        { code: 'MAGIC_BYTE_MISMATCH', message: 'File bytes do not match declared MIME' },
        { status: 415, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const publicId = `site-videos/${auth.admin.id}/${randomUUID()}`;

    let uploaded;
    try {
      uploaded = await uploadBuffer(publicId, buf);
    } catch (e) {
      if (e instanceof StorageNotConfiguredError) {
        return NextResponse.json(
          { code: 'STORAGE_NOT_CONFIGURED', message: 'Storage not configured' },
          { status: 503, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      return NextResponse.json(
        { code: 'UPLOAD_FAILED', message: 'Storage write failed' },
        { status: 502, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const row = await prisma.fileUpload.create({
      data: {
        userId: auth.admin.id,
        key: uploaded.publicId,
        filename: sanitizeFilename(file.name),
        mimeType: file.type,
        sizeBytes: uploaded.bytes,
      },
      select: { id: true, key: true, filename: true, mimeType: true, sizeBytes: true },
    });

    return NextResponse.json(
      { ...row, url: uploaded.secureUrl },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
