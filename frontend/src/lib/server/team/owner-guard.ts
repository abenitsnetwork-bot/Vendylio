// Phase 4a — "OWNER-only" gate for routes a teammate must not reach
// (withdrawals, billing). A store can have OrganizationMember rows with role
// ADMIN / MEMBER; those members get full dashboard access via
// `resolveOwnStore`, but money + subscription actions stay with the owner.
//
//   const store = await resolveOwnStore(auth.user.sub);
//   if (store) {
//     const gate = await requireStoreOwner(store, ctx.requestId);
//     if (gate) return gate;
//   }
import 'server-only';
import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/server/middleware';

export async function requireStoreOwner(
  store: { organizationId: string },
  requestId: string,
  message = 'Only the store owner can do this.',
): Promise<NextResponse | null> {
  const gate = await requireOrgRole(store.organizationId, 'OWNER');
  if (gate instanceof NextResponse) {
    return NextResponse.json(
      { error: 'OWNER_ONLY', code: 'OWNER_ONLY', message },
      { status: 403, headers: { 'x-request-id': requestId } },
    );
  }
  return null;
}
