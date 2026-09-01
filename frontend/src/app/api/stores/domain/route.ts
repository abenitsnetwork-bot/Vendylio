// GET/POST/DELETE /api/stores/domain — connect a custom storefront domain (Pro).
//
// Phase 4b. POST adds the domain to the Vercel project (status PENDING) and
// returns the DNS records the merchant must create. GET re-checks Vercel and
// promotes PENDING → ACTIVE once the domain verifies; the middleware rewrite
// only serves the storefront on an ACTIVE domain. DELETE detaches it.
//
// Gated: requireAuth + resolveOwnStore + requireStoreOwner (teammates can't
// touch it) + requirePro(store, 'customDomain') → 402. Inert without
// VERCEL_API_TOKEN / VERCEL_PROJECT_ID → 503 DOMAIN_NOT_CONFIGURED.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma, type Store } from '@prisma/client';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { requireStoreOwner } from '@/lib/server/team/owner-guard';
import { requirePro } from '@/lib/server/middleware/require-pro';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import {
  isDomainConfigured,
  addDomainToProject,
  removeDomainFromProject,
  getDomainState,
  VercelApiError,
  type DomainState,
} from '@/lib/server/domains/vercel';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

const HOSTNAME_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-)){1,}$/;

function reservedHost(host: string): boolean {
  const appHost = (() => {
    try {
      return new URL(process.env.APP_URL ?? 'http://localhost:3000').hostname.toLowerCase();
    } catch {
      return 'localhost';
    }
  })();
  return host === appHost || host.endsWith('.vercel.app') || host.endsWith(appHost);
}

const PostBody = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((d) =>
      d
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/\.$/, ''),
    )
    .refine((d) => HOSTNAME_RE.test(d), 'Enter a valid domain like shop.yourbrand.com')
    .refine((d) => !reservedHost(d), 'That domain cannot be used'),
});

type Guarded = { store: Store };

async function guard(sub: string, requestId: string): Promise<Guarded | NextResponse> {
  const store = await resolveOwnStore(sub);
  if (!store) {
    return NextResponse.json(
      { error: 'NO_STORE', message: 'Create a store first.' },
      { status: 404, headers: { 'x-request-id': requestId } },
    );
  }
  const ownerGate = await requireStoreOwner(
    store,
    requestId,
    'Only the store owner can manage the domain.',
  );
  if (ownerGate) return ownerGate;
  const proGate = requirePro(store, 'customDomain');
  if (proGate) return proGate;
  if (!isDomainConfigured()) {
    return NextResponse.json(
      { error: 'DOMAIN_NOT_CONFIGURED', message: 'Custom domains are not available yet.' },
      { status: 503, headers: { 'x-request-id': requestId } },
    );
  }
  return { store };
}

function payload(store: Guarded['store'], state: DomainState | null): Record<string, unknown> {
  return {
    customDomain: store.customDomain,
    status: store.customDomainStatus,
    verified: state?.verified ?? store.customDomainStatus === 'ACTIVE',
    misconfigured: state?.misconfigured ?? false,
    records: state?.records ?? [],
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const g = await guard(auth.user.sub, ctx.requestId);
    if (g instanceof NextResponse) return g;

    let state: DomainState | null = null;
    if (g.store.customDomain && g.store.customDomainStatus !== 'NONE') {
      try {
        state = await getDomainState(g.store.customDomain);
        const nextStatus = state.verified && !state.misconfigured ? 'ACTIVE' : 'PENDING';
        if (nextStatus !== g.store.customDomainStatus) {
          await prisma.store.update({
            where: { id: g.store.id },
            data: { customDomainStatus: nextStatus },
          });
          g.store.customDomainStatus = nextStatus;
        }
      } catch (err) {
        log.warn('domain: getDomainState failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json(payload(g.store, state), {
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const g = await guard(auth.user.sub, ctx.requestId);
    if (g instanceof NextResponse) return g;

    const parsed = PostBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const domain = parsed.data.domain;

    // Detach an existing domain first (Vercel rejects a second one otherwise).
    if (g.store.customDomain && g.store.customDomain !== domain) {
      await removeDomainFromProject(g.store.customDomain).catch(() => {});
    }

    let state: DomainState;
    try {
      state = await addDomainToProject(domain);
    } catch (err) {
      if (
        err instanceof VercelApiError &&
        /already in use|domain_taken|forbidden/i.test(err.message + err.code)
      ) {
        return NextResponse.json(
          { error: 'DOMAIN_TAKEN', message: 'That domain is already connected somewhere else.' },
          { status: 409, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      log.warn('domain: addDomainToProject failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: 'DOMAIN_ADD_FAILED', message: 'Could not add the domain. Try again shortly.' },
        { status: 502, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    try {
      await prisma.store.update({
        where: { id: g.store.id },
        data: { customDomain: domain, customDomainStatus: 'PENDING' },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await removeDomainFromProject(domain).catch(() => {});
        return NextResponse.json(
          { error: 'DOMAIN_TAKEN', message: 'That domain is already connected to another store.' },
          { status: 409, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      throw err;
    }

    g.store.customDomain = domain;
    g.store.customDomainStatus = 'PENDING';
    return NextResponse.json(payload(g.store, state), {
      status: 201,
      headers: { 'x-request-id': ctx.requestId },
    });
  });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const g = await guard(auth.user.sub, ctx.requestId);
    if (g instanceof NextResponse) return g;

    if (g.store.customDomain) {
      await removeDomainFromProject(g.store.customDomain).catch((err) => {
        log.warn('domain: removeDomainFromProject failed', {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
    await prisma.store.update({
      where: { id: g.store.id },
      data: { customDomain: null, customDomainStatus: 'NONE' },
    });

    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
