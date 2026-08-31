// GET + PATCH /api/stores/fulfillment — the merchant's per-method delivery
// config (Prompt #12). Separate route from PATCH /api/stores so the
// fulfillment settings form has a focused endpoint.
//
// GET returns the normalized config + a per-provider CONFIGURED / ENABLED /
// DISABLED / UNAVAILABLE state (config state ≠ runtime health).
// PATCH validates + persists `Store.fulfillmentConfig`; enabling a courier
// whose PLATFORM credentials aren't set is allowed but flagged in `warnings`.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import {
  readFulfillmentConfig,
  serializeFulfillmentConfig,
  type FulfillmentConfig,
} from '@/lib/server/fulfillment/config';
import { getDeliveryProvider } from '@/lib/server/fulfillment/registry';
import { PROVIDER_TYPES, type ProviderType } from '@/lib/server/fulfillment/types';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const PatchBody = z.object({
  pickup: z
    .object({
      enabled: z.boolean().optional(),
      instructions: z.string().trim().max(280).nullable().optional(),
    })
    .optional(),
  merchant: z
    .object({
      enabled: z.boolean().optional(),
      feeCents: z.number().int().min(0).max(100_000).optional(),
      minOrderCents: z.number().int().min(0).max(1_000_000).optional(),
      instructions: z.string().trim().max(280).nullable().optional(),
    })
    .optional(),
  uberDirect: z.object({ enabled: z.boolean() }).optional(),
  doordash: z.object({ enabled: z.boolean() }).optional(),
  customerChoosesProvider: z.boolean().optional(),
});

type ConfigState = 'CONFIGURED' | 'ENABLED' | 'DISABLED' | 'UNAVAILABLE';

function providerState(type: ProviderType, cfg: FulfillmentConfig): ConfigState {
  const enabled =
    type === 'UBER_DIRECT'
      ? cfg.uberDirect.enabled
      : type === 'DOORDASH'
        ? cfg.doordash.enabled
        : type === 'MERCHANT'
          ? cfg.merchant.enabled
          : cfg.pickup.enabled;
  const configured = getDeliveryProvider(type).isConfigured();
  if (!enabled) return configured ? 'CONFIGURED' : 'DISABLED';
  return configured ? 'ENABLED' : 'UNAVAILABLE';
}

function statesFor(cfg: FulfillmentConfig): Record<string, ConfigState> {
  return Object.fromEntries(PROVIDER_TYPES.map((t) => [t, providerState(t, cfg)]));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'STORE_NOT_FOUND', message: 'You have no store yet.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    const cfg = readFulfillmentConfig(store);
    return NextResponse.json(
      { config: serializeFulfillmentConfig(cfg), providerStates: statesFor(cfg) },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'STORE_NOT_FOUND', message: 'You have no store yet.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const current = readFulfillmentConfig(store);
    const p = parsed.data;
    const next: FulfillmentConfig = {
      pickup: {
        enabled: p.pickup?.enabled ?? current.pickup.enabled,
        instructions:
          p.pickup?.instructions === undefined
            ? current.pickup.instructions
            : (p.pickup.instructions ?? null),
      },
      merchant: {
        enabled: p.merchant?.enabled ?? current.merchant.enabled,
        feeCents: p.merchant?.feeCents ?? current.merchant.feeCents,
        minOrderCents: p.merchant?.minOrderCents ?? current.merchant.minOrderCents,
        instructions:
          p.merchant?.instructions === undefined
            ? current.merchant.instructions
            : (p.merchant.instructions ?? null),
      },
      uberDirect: { enabled: p.uberDirect?.enabled ?? current.uberDirect.enabled },
      doordash: { enabled: p.doordash?.enabled ?? current.doordash.enabled },
      customerChoosesProvider: p.customerChoosesProvider ?? current.customerChoosesProvider,
    };

    await prisma.store.update({
      where: { id: store.id },
      data: {
        fulfillmentConfig: serializeFulfillmentConfig(next) as Prisma.InputJsonValue,
      },
    });

    const states = statesFor(next);
    const warnings = Object.entries(states)
      .filter(([, s]) => s === 'UNAVAILABLE')
      .map(([provider]) => ({
        provider,
        message: `${provider} is enabled but its platform credentials aren't set — it won't appear at checkout yet.`,
      }));

    return NextResponse.json(
      { config: serializeFulfillmentConfig(next), providerStates: states, warnings },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
