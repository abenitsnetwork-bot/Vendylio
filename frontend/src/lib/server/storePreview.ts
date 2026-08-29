// Shared "is the person looking at this storefront its owner?" check, used by
// the public store + product pages so a merchant can preview their own DRAFT
// store (which 404s for everyone else) without publishing it.
import 'server-only';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifyToken } from '@/lib/server/auth';
import { resolveOwnStore } from '@/lib/server/org';

export async function viewerOwnsSlug(slug: string): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return false;
  const payload = await verifyToken(token);
  if (!payload) return false;
  const ownStore = await resolveOwnStore(payload.sub);
  return ownStore?.slug === slug;
}
