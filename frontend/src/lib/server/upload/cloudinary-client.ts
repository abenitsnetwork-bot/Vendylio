// Lazy-initialized Cloudinary singleton + uploader accessor.
//
// Why lazy?
//   `cloudinary.config({...})` itself doesn't throw on missing creds — calls
//   would only fail at request time with an opaque error. Worse, our route
//   should return a clean 503 STORAGE_NOT_CONFIGURED instead of a generic
//   500. By gating configuration on the three required envs
//   (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET), we
//   throw a typed `StorageNotConfiguredError` synchronously on first use.
//   Routes catch `instanceof` and translate to 503.
//
//   Additionally, this avoids reading `process.env` at module top-level —
//   which would lock in stale values for tests that mutate the env.
//
// Pitfall (env.ts Zod rejection): CLOUDINARY_* keys are deliberately NOT
// added to `frontend/src/lib/server/env.ts`'s Zod schema. The schema rejects
// empty strings, which would refuse to boot the whole app whenever
// Cloudinary is unconfigured (dev / CI). Lazy-init handles `?? ''`
// empty-as-absent directly.
import 'server-only';
import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from 'cloudinary';

/**
 * Thrown by `getCloudinaryUploader()` when any of `CLOUDINARY_CLOUD_NAME`,
 * `CLOUDINARY_API_KEY`, or `CLOUDINARY_API_SECRET` is missing/empty. The
 * upload route catches this `instanceof` and returns 503
 * `{ code: 'STORAGE_NOT_CONFIGURED' }`. The error message intentionally
 * avoids echoing any env values — only names — so a stack trace surfaced
 * via Sentry never leaks a partial credential.
 */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      'Storage not configured (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET missing or empty)',
    );
    this.name = 'StorageNotConfiguredError';
  }
}

/**
 * Result shape returned by `uploadBuffer()`. Mirrors the small subset of
 * `UploadApiResponse` the upload route consumes; we don't leak the full
 * Cloudinary surface upstream.
 */
export interface UploadResult {
  /** Cloudinary public_id — stored as `FileUpload.key` for forward-compat. */
  publicId: string;
  /** HTTPS CDN URL the browser hits directly (no proxy). */
  secureUrl: string;
  /** Stored byte length. */
  bytes: number;
}

let _configured = false;
let _preset: string | null = null;
let _cloudName = '';
let _apiKey = '';

function configureOnce(): void {
  if (_configured) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? '';
  const apiKey = process.env.CLOUDINARY_API_KEY ?? '';
  const apiSecret = process.env.CLOUDINARY_API_SECRET ?? '';
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET ?? '';

  if (!cloudName || !apiKey || !apiSecret) {
    throw new StorageNotConfiguredError();
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  _preset = uploadPreset || null;
  _cloudName = cloudName;
  _apiKey = apiKey;
  _configured = true;
}

/**
 * Upload a buffer to Cloudinary. Streams the bytes via `upload_stream` and
 * resolves with the public_id + secure_url. Throws `StorageNotConfiguredError`
 * when the three required envs are missing; the route translates to 503.
 *
 * `publicId` is supplied by the caller (the upload route builds a path-like
 * key, `{userId}/{cuid}`) so we don't depend on Cloudinary's random ID.
 */
export async function uploadBuffer(publicId: string, body: Buffer): Promise<UploadResult> {
  configureOnce();

  // resource_type 'auto' lets Cloudinary pick image/video/raw from the bytes,
  // matching the route's MIME-allowlist approach (we already validated the
  // MIME server-side; Cloudinary's auto-detect is the secondary safety net).
  const options: UploadApiOptions = {
    public_id: publicId,
    resource_type: 'auto',
  };
  if (_preset) options.upload_preset = _preset;

  const res = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, response) => {
      if (err) return reject(err);
      if (!response) return reject(new Error('Cloudinary upload returned no response'));
      resolve(response);
    });
    stream.end(body);
  });

  return {
    publicId: res.public_id,
    secureUrl: res.secure_url,
    bytes: typeof res.bytes === 'number' ? res.bytes : body.length,
  };
}

export interface SignedUpload {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  publicId: string;
  /** The browser POSTs the file directly here — bytes never pass through
   * our server. */
  uploadUrl: string;
}

/**
 * Signs a direct browser→Cloudinary upload. Vercel Serverless Functions cap
 * request bodies at ~4.5MB, far below a real video file, so video uploads
 * cannot be proxied through our own route the way image uploads are
 * (POST /api/upload buffers the whole body first). Instead the browser
 * uploads straight to Cloudinary's API using a short-lived signature we mint
 * here — our server never sees the video bytes at all.
 *
 * `resource_type` is encoded in `uploadUrl`'s path (not a signed param).
 */
export function signVideoUpload(publicId: string): SignedUpload {
  configureOnce();

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign: Record<string, string | number> = { public_id: publicId, timestamp };
  if (_preset) paramsToSign.upload_preset = _preset;

  const apiSecret = process.env.CLOUDINARY_API_SECRET ?? '';
  const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

  return {
    cloudName: _cloudName,
    apiKey: _apiKey,
    timestamp,
    signature,
    publicId,
    uploadUrl: `https://api.cloudinary.com/v1_1/${_cloudName}/video/upload`,
  };
}

/**
 * Test-only escape hatch — clears the cached configuration flag so a test can
 * mutate `process.env.CLOUDINARY_*` and re-trigger lazy init. Never call this
 * from application code.
 *
 * @internal
 */
export function __resetCloudinarySingleton(): void {
  _configured = false;
  _preset = null;
  _cloudName = '';
  _apiKey = '';
}
