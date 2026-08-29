// POST /api/stores — seller onboarding: create an Organization, make the
// caller its OWNER member, and create the one Store that Organization owns.
//
// One store per organization (Store.organizationId is @unique), one
// organization per caller for the MVP (no team invites yet) — checked
// explicitly before slug generation so a second attempt gets a clean 409
// STORE_ALREADY_EXISTS instead of exhausting ensureUniqueSlug's retry budget
// on an unrelated unique-constraint hit.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { slugify, ensureUniqueSlug } from '@/lib/server/slug';
import { DEFAULT_CATEGORIES } from '@/lib/productCategories';
import { checkPickupAddressDeliverable } from '@/lib/server/delivery/uber-direct';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { STORE_TEMPLATE_VALUES } from '@/lib/storeTemplates';

const Body = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  logoUrl: z.string().url().optional(),
  // Free-text, no format validation — sellers span many countries/formats
  // and this is display-only (shown in the storefront's top bar), never
  // dialed programmatically. See Store.phone in schema.prisma.
  phone: z.string().trim().max(40).optional(),
  // Onboarding lets the merchant edit the suggested store link before
  // creation (never after — see PATCH below). Optional: omitting it keeps
  // the original behavior of deriving the slug from `name`. Still goes
  // through slugify + ensureUniqueSlug below, so this can't be used to
  // bypass uniqueness/reserved-word checks.
  slug: z.string().trim().min(2).max(64).optional(),
});

// PATCH allows re-editing name/description/city/state/logoUrl but never the
// slug — the slug is the store's public URL; changing it silently would
// break links a seller already shared.
const PatchBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  // Manual payment methods — free text, no format validation (same reasoning
  // as phone). Stored without a leading "$" on the cashtag; the settings
  // form strips it before sending, but strip defensively here too in case a
  // future caller doesn't.
  cashAppCashtag: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => (v ? v.replace(/^\$/, '') : v)),
  zelleContact: z.string().trim().max(120).nullable().optional(),
  template: z.enum(STORE_TEMPLATE_VALUES).optional(),
  published: z.boolean().optional(),
  // Flat delivery fee added to every checkout at this store, smallest
  // currency unit (cents).
  deliveryFeeCents: z.number().int().min(0).optional(),
  // "self_manual" (default, zero config) or "uber_direct" (real courier —
  // requires pickupAddress below + platform-level UBER_DIRECT_* env vars,
  // see lib/server/delivery/uber-direct.ts). Any other value falls back to
  // self_manual at read time (getDeliveryProviderFor), so this is
  // intentionally not a strict enum — a fork adding a third provider name
  // doesn't need to touch this route.
  deliveryProvider: z.string().trim().max(40).optional(),
  // Required for uber_direct to dispatch a courier; self_manual ignores it.
  // Free-text, no format validation — same reasoning as Store.phone.
  pickupAddress: z.string().trim().max(200).nullable().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const existing = await resolveOwnStore(auth.user.sub);
    if (existing) {
      return NextResponse.json(
        { error: 'STORE_ALREADY_EXISTS', message: 'You already have a store.' },
        { status: 409, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const { name, description, city, state, logoUrl, phone, slug } = parsed.data;
    let store: Awaited<ReturnType<typeof prisma.store.create>> | null = null;
    await ensureUniqueSlug(slugify(slug || name) || 'store', async (candidate) => {
      store = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: { slug: candidate, name, ownerId: auth.user.sub },
        });
        await tx.organizationMember.create({
          data: { organizationId: organization.id, userId: auth.user.sub, role: 'OWNER' },
        });
        const created = await tx.store.create({
          data: {
            organizationId: organization.id,
            slug: candidate,
            name,
            ...(description ? { description } : {}),
            ...(city ? { city } : {}),
            ...(state ? { state } : {}),
            ...(logoUrl ? { logoUrl } : {}),
            ...(phone ? { phone } : {}),
          },
        });
        // Seed the starter category set so a new store isn't a blank slate.
        // The seller renames/reorders/deletes these freely in Settings.
        await tx.category.createMany({
          data: DEFAULT_CATEGORIES.map((catName, i) => ({
            storeId: created.id,
            name: catName,
            slug: slugify(catName),
            sortOrder: i,
          })),
        });
        return created;
      });
      return store;
    });

    return NextResponse.json(
      { store },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const existing = await resolveOwnStore(auth.user.sub);
    if (!existing) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'No store yet.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // Strip undefined keys — Prisma's update input rejects an explicit
    // `undefined` value under exactOptionalPropertyTypes even on optional
    // fields, so only pass the keys the caller actually sent.
    const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));

    const store = await prisma.store.update({
      where: { id: existing.id },
      data,
    });

    // Best-effort, non-blocking: warn the seller immediately if their Uber
    // Direct pickup address looks undeliverable, instead of them finding
    // out only after a real order is paid and "Request Delivery" fails
    // (confirmed live — see checkPickupAddressDeliverable's docstring).
    // Only worth the extra API call when this save actually touched the
    // pickup address or turned Uber Direct on for the first time.
    let deliverabilityWarning: string | undefined;
    if (
      store.deliveryProvider === 'uber_direct' &&
      store.pickupAddress &&
      ('pickupAddress' in data || 'deliveryProvider' in data)
    ) {
      const deliverable = await checkPickupAddressDeliverable(store.pickupAddress);
      if (deliverable === false) {
        deliverabilityWarning =
          'Uber Direct does not currently service this pickup address — courier delivery requests from this store are likely to fail.';
      }
    }

    return NextResponse.json(
      { store, ...(deliverabilityWarning ? { deliverabilityWarning } : {}) },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
