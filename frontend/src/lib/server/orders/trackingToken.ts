// Phase 7 — the guest order-tracking bearer token (see Order.trackingToken in
// schema.prisma). 24 random bytes → 32 url-safe base64 chars. Generated here
// at checkout time and stored on the row; every guest-facing order URL and
// every transactional email link carries this, never the cuid `id`.
import 'server-only';
import { randomBytes } from 'node:crypto';

export function newTrackingToken(): string {
  return randomBytes(24).toString('base64url');
}
