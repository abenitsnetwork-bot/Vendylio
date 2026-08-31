/**
 * DoorDash Drive auth — the client self-signs a short-lived JWT from the three
 * developer credentials (there is no token endpoint). Per the official Drive
 * docs: HS256, a `dd-ver: DD-JWT-V1` header claim, `aud: "doordash"`, and the
 * signing secret is base64-encoded and must be decoded to raw bytes for the
 * HMAC key.
 *
 * Kept as a ~30-line local signer (node:crypto) rather than pulling in
 * `jsonwebtoken` or touching the PROTECTED `crypto.ts`.
 */
import 'server-only';
import { createHmac } from 'crypto';

export interface DoorDashCredentials {
  developerId: string;
  keyId: string;
  signingSecret: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Sign a Drive access JWT valid for `ttlSeconds` (default 300). */
export function signDoorDashJwt(creds: DoorDashCredentials, ttlSeconds = 300): string {
  const header = { alg: 'HS256', typ: 'JWT', 'dd-ver': 'DD-JWT-V1' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'doordash',
    iss: creds.developerId,
    kid: creds.keyId,
    exp: now + ttlSeconds,
    iat: now,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // DoorDash issues the signing secret base64-encoded; decode to raw key bytes.
  const key = Buffer.from(creds.signingSecret, 'base64');
  const signature = createHmac('sha256', key).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function readDoorDashCredentials(): DoorDashCredentials | null {
  const developerId = process.env.DOORDASH_DEVELOPER_ID;
  const keyId = process.env.DOORDASH_KEY_ID;
  const signingSecret = process.env.DOORDASH_SIGNING_SECRET;
  if (!developerId || !keyId || !signingSecret) return null;
  return { developerId, keyId, signingSecret };
}

// Module-level cache — one JWT per process, refreshed a minute before expiry.
// Single-instance, same documented limitation as the Uber token cache /
// payments/circuit-breaker.ts.
let cached: { token: string; expiresAt: number } | null = null;

export function getDoorDashJwt(): string {
  const creds = readDoorDashCredentials();
  if (!creds) throw new Error('DoorDash Drive is not configured.');
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.token;
  const token = signDoorDashJwt(creds, 300);
  cached = { token, expiresAt: now + 240_000 }; // refresh after 4 min
  return token;
}

/** Test-only — drop the cached JWT. */
export function __resetDoorDashJwtCache(): void {
  cached = null;
}
