/**
 * POST /api/admin/upload-video/sign — SUPERADMIN-only. Mints a short-lived
 * signature for a direct browser→Cloudinary video upload.
 *
 * Video files routinely exceed Vercel Serverless Functions' ~4.5MB request
 * body cap, so unlike POST /api/upload (images, buffered through our own
 * route), the video bytes never touch our server: the browser POSTs straight
 * to Cloudinary's API using the signature this route returns. This endpoint
 * itself has no body to speak of — just an authorization + signing step.
 */
export const runtime = 'nodejs';

import { randomUUID } from 'node:crypto';
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { StorageNotConfiguredError, signVideoUpload } from '@/lib/server/upload/cloudinary-client';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    try {
      const publicId = `site-videos/${auth.admin.id}/${randomUUID()}`;
      const signed = signVideoUpload(publicId);
      return NextResponse.json(signed, { headers: { 'x-request-id': ctx.requestId } });
    } catch (err) {
      if (err instanceof StorageNotConfiguredError) {
        return NextResponse.json(
          { code: 'STORAGE_NOT_CONFIGURED', message: 'Storage not configured' },
          { status: 503, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      throw err;
    }
  });
}
