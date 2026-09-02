// frontend/src/test-integration/harness.ts — shared helpers for *.itest.ts.
//
// Real Prisma client (the same singleton the routes import), a stateful cookie
// jar for next/headers, request builders, and seed helpers that write fixtures
// straight to the database.
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { createAccessToken, COOKIE_NAME } from '@/lib/server/auth';
import { truncateAll } from './db';

export { prisma };

// ── Cookie jar (backs the next/headers mock in setup.ts) ────────────────────
interface JarEntry {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}
const jar = new Map<string, JarEntry>();

export function cookieJar() {
  return {
    get(name: string): { name: string; value: string } | undefined {
      const e = jar.get(name);
      return e ? { name: e.name, value: e.value } : undefined;
    },
    set(name: string, value: string, options?: Record<string, unknown>): void {
      jar.set(name, { name, value, ...(options ? { options } : {}) });
    },
    delete(name: string): void {
      jar.delete(name);
    },
    has(name: string): boolean {
      return jar.has(name);
    },
    getAll(): Array<{ name: string; value: string }> {
      return [...jar.values()].map((e) => ({ name: e.name, value: e.value }));
    },
  };
}

export function resetCookieJar(): void {
  jar.clear();
}

/** Put a signed access cookie for `user` into the jar (skips the login route). */
export async function authAs(user: { id: string; email: string }): Promise<void> {
  const token = await createAccessToken({ sub: user.id, email: user.email, tokenVersion: 0 });
  cookieJar().set(COOKIE_NAME, token);
}

export function logout(): void {
  jar.delete(COOKIE_NAME);
}

// ── Request builders ───────────────────────────────────────────────────────
interface ReqOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

/** A NextRequest with a JSON body, a CSRF header, and (optionally) an
 * Idempotency-Key. verifyCsrf() only needs the header present when no csrf
 * cookie is set — which is the case here. */
export function apiRequest(url: string, opts: ReqOpts = {}): NextRequest {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-csrf-token': 'itest-csrf',
    ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
    ...opts.headers,
  };
  const init: ConstructorParameters<typeof NextRequest>[1] = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}

/** A raw NextRequest (used for the Stripe webhook — body is pre-signed bytes). */
export function rawRequest(
  url: string,
  body: Buffer | string,
  headers: Record<string, string>,
): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    headers,
    body: body as unknown as BodyInit,
  });
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

// ── DB lifecycle ───────────────────────────────────────────────────────────
export async function truncate(): Promise<void> {
  await truncateAll(prisma as never);
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

// ── Seed helpers ───────────────────────────────────────────────────────────
export async function seedVerifiedUser(
  over: Partial<{ email: string; role: 'USER' | 'ADMIN' | 'SUPERADMIN' }> = {},
): Promise<{ id: string; email: string }> {
  const email = over.email ?? `seller-${randomUUID().slice(0, 8)}@itest.dev`;
  const user = await prisma.user.create({
    data: {
      email,
      // bcrypt hash of "correct horse battery staple" — never used (auth is
      // via authAs()), but the column is non-null.
      passwordHash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      emailVerifiedAt: new Date(),
      ...(over.role ? { role: over.role } : {}),
    },
    select: { id: true, email: true },
  });
  return user;
}

export async function seedStore(
  ownerId: string,
  over: Partial<{
    slug: string;
    name: string;
    published: boolean;
    plan: 'FREE' | 'PRO';
    cashAppCashtag: string | null;
    stripeCustomerId: string | null;
  }> = {},
): Promise<{ id: string; slug: string; organizationId: string }> {
  const slug = over.slug ?? `shop-${randomUUID().slice(0, 8)}`;
  const name = over.name ?? 'Integration Test Store';
  const org = await prisma.organization.create({
    data: { slug, name, ownerId },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: ownerId, role: 'OWNER' },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      slug,
      name,
      published: over.published ?? true,
      ...((over.published ?? true) ? { publishedAt: new Date() } : {}),
      plan: over.plan ?? 'FREE',
      termsAcceptedAt: new Date(),
      termsVersion: '1',
      ...(over.cashAppCashtag !== undefined ? { cashAppCashtag: over.cashAppCashtag } : {}),
      ...(over.stripeCustomerId !== undefined ? { stripeCustomerId: over.stripeCustomerId } : {}),
    },
    select: { id: true, slug: true, organizationId: true },
  });
  return store;
}

/** Commission rates default to 0 with no row — seed one so the money path
 * actually accrues commission. 600bp = 6%. */
export async function seedPlatformSettings(commissionRateBp = 600): Promise<void> {
  await prisma.platformSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', commissionRateBp },
    update: { commissionRateBp },
  });
}

export async function seedProduct(
  storeId: string,
  over: Partial<{ name: string; priceCents: number; quantity: number; status: string }> = {},
): Promise<{ id: string; priceCents: number; quantity: number }> {
  const product = await prisma.product.create({
    data: {
      storeId,
      name: over.name ?? 'Shea Butter 8oz',
      priceCents: over.priceCents ?? 1800,
      quantity: over.quantity ?? 25,
      status: over.status ?? 'ACTIVE',
      unit: 'UNIT',
    },
    select: { id: true, priceCents: true, quantity: true },
  });
  return product;
}
