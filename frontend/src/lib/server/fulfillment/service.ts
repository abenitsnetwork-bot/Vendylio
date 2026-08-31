/**
 * Prompt #12 — the central fulfillment service.
 *
 * Every state change to a `Delivery` — from `markPaid.ts`, the
 * `fulfillment-tick` cron, a provider webhook, or a merchant click — goes
 * through `recordTransition` here. It is the only code that writes
 * `Delivery.state` / `Delivery.status` and that maps a delivery state onto the
 * commercial `Order.status`.
 *
 * Phase 1 ships: `recordTransition`, `initFulfillment`, `handleProviderEvent`,
 * `selectProvider`, `quoteMethod`. Courier dispatch (`createFulfillment`) and
 * `cancelFulfillment` are fleshed out in Phase 2 / Phase 5.
 */
import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaTransactionClient } from '@/lib/server/webhook/handler';
import { log } from '@/lib/server/observability/log';
import { canTransition, mapToOrderStatus } from './stateMachine';
import type {
  DeliveryQuote,
  DeliveryQuoteInput,
  FulfillmentActor,
  NormalizedState,
  ProviderSnapshot,
  ProviderType,
} from './types';
import { getDeliveryProvider, type ProviderContext } from './registry';
import type { FulfillmentConfig } from './config';

/** Minimal tx client shape the service needs (real tx or the deep mock) —
 *  same alias `markPaid.ts` / the webhook factory use. */
export type FulfillmentTx = PrismaTransactionClient;

// ── Legacy dual-write maps ───────────────────────────────────────────────

/** New `state` → the Phase-5 `Delivery.status` the tracking route reads. */
function legacyStatusFor(state: NormalizedState): 'REQUESTED' | 'DELIVERED' | 'FAILED' {
  if (state === 'DELIVERED') return 'DELIVERED';
  if (state === 'FAILED' || state === 'CANCELLED') return 'FAILED';
  return 'REQUESTED';
}

/** `ProviderType` → the Phase-5 `Delivery.provider` string. */
export function legacyProviderFor(type: ProviderType): string {
  return type === 'UBER_DIRECT' ? 'uber_direct' : type === 'DOORDASH' ? 'doordash' : 'self_manual';
}

function orderEventActor(actor: FulfillmentActor): 'SYSTEM' | 'SELLER' {
  return actor === 'MERCHANT' ? 'SELLER' : 'SYSTEM';
}

// ── recordTransition ─────────────────────────────────────────────────────

export interface RecordTransitionInput {
  deliveryId: string;
  toState: NormalizedState;
  actor: FulfillmentActor;
  /** Webhook event id, or `poll:<hash>` for a cron poll. Enables idempotency:
   *  a repeat with the same id is a no-op. */
  providerEventId?: string | null;
  providerStatus?: string | null;
  /** Extra columns to set on the `Delivery` row alongside `state`. */
  patch?: Prisma.DeliveryUpdateInput;
  /** Raw payload stored on the `DeliveryEvent` for forensics. */
  payload?: Prisma.InputJsonValue;
}

export interface RecordTransitionResult {
  changed: boolean;
  deduped: boolean;
  /** The delivery's state after the call (unchanged if `changed` is false). */
  state: NormalizedState;
}

/**
 * Apply one state change, idempotently and monotonically.
 *
 * - a repeat of a `providerEventId` we've already recorded → `{ deduped: true }`
 * - a transition the state machine rejects (out-of-order / illegal) → the
 *   `DeliveryEvent` is still written (forensics) but `Delivery.state` is
 *   untouched → `{ changed: false }`
 * - allowed → `Delivery` updated (+ legacy `status`), `DeliveryEvent` written,
 *   `Order.status` mapped, an `OrderStatusEvent` appended when the order moves.
 */
export async function recordTransition(
  tx: FulfillmentTx,
  input: RecordTransitionInput,
): Promise<RecordTransitionResult> {
  const delivery = await tx.delivery.findUnique({
    where: { id: input.deliveryId },
    select: { id: true, orderId: true, state: true, providerType: true },
  });
  if (!delivery) throw new Error(`recordTransition: no Delivery ${input.deliveryId}`);

  const from = delivery.state as NormalizedState;

  // 1. Idempotency gate — a replayed webhook / repeated poll.
  if (input.providerEventId) {
    const seen = await tx.deliveryEvent.findUnique({
      where: {
        deliveryId_providerEventId: {
          deliveryId: delivery.id,
          providerEventId: input.providerEventId,
        },
      },
      select: { id: true },
    });
    if (seen) return { changed: false, deduped: true, state: from };
  }

  const allowed = canTransition(from, input.toState, input.actor);

  // 2. Always record the event (even a rejected/out-of-order one).
  await tx.deliveryEvent.create({
    data: {
      deliveryId: delivery.id,
      state: input.toState,
      source: input.actor,
      ...(input.providerStatus ? { providerStatus: input.providerStatus } : {}),
      ...(input.providerEventId ? { providerEventId: input.providerEventId } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    },
  });

  if (!allowed) {
    log.info('fulfillment: transition not applied (illegal or out-of-order)', {
      deliveryId: delivery.id,
      from,
      to: input.toState,
      actor: input.actor,
    });
    return { changed: false, deduped: false, state: from };
  }

  // 3. Apply.
  const now = new Date();
  const deliveryPatch: Prisma.DeliveryUpdateInput = {
    state: input.toState,
    status: legacyStatusFor(input.toState),
    ...(input.providerStatus ? { lastProviderStatus: input.providerStatus } : {}),
    ...(input.toState === 'PICKED_UP' ? { pickedUpAt: now } : {}),
    ...(input.toState === 'DELIVERED' ? { deliveredAt: now } : {}),
    ...(input.toState === 'CANCELLED' ? { cancelledAt: now } : {}),
    ...(input.patch ?? {}),
  };
  await tx.delivery.update({ where: { id: delivery.id }, data: deliveryPatch });

  // 4. Map to Order.status.
  const map = mapToOrderStatus(input.toState);
  if (map.target) {
    const order = await tx.order.findUnique({
      where: { id: delivery.orderId },
      select: { status: true },
    });
    const canMove =
      order &&
      order.status !== map.target &&
      (!map.onlyIfCurrentlyOutForDelivery || order.status === 'OUT_FOR_DELIVERY');
    if (canMove) {
      await tx.order.update({
        where: { id: delivery.orderId },
        data: { status: map.target },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId: delivery.orderId,
          status: map.target,
          actorType: orderEventActor(input.actor),
        },
      });
    }
  }

  return { changed: true, deduped: false, state: input.toState };
}

// ── initFulfillment ──────────────────────────────────────────────────────

export interface InitFulfillmentInput {
  orderId: string;
  providerType: ProviderType;
  feeCents: number;
  currency: string;
  quoteId?: string | null;
  providerQuoteId?: string | null;
  quoteExpiresAt?: Date | null;
}

/**
 * Called from `markPaid.ts` inside the payment tx for every paid non-PICKUP
 * order. Creates (or leaves) a `Delivery` row in `state: PENDING` — no
 * external call. The `fulfillment-tick` cron dispatches it later. Idempotent:
 * a Serializable retry or a double payment finds the existing row and no-ops.
 */
export async function initFulfillment(
  tx: FulfillmentTx,
  input: InitFulfillmentInput,
): Promise<void> {
  await tx.delivery.upsert({
    where: { orderId: input.orderId },
    create: {
      orderId: input.orderId,
      state: 'PENDING',
      status: 'REQUESTED',
      providerType: input.providerType,
      provider: legacyProviderFor(input.providerType),
      feeCents: input.feeCents,
      quotedFeeCents: input.feeCents,
      currency: input.currency,
      ...(input.quoteId ? { quoteId: input.quoteId } : {}),
      ...(input.providerQuoteId ? { providerQuoteId: input.providerQuoteId } : {}),
      ...(input.quoteExpiresAt ? { quoteExpiresAt: input.quoteExpiresAt } : {}),
    },
    update: {},
  });
}

// ── handleProviderEvent ──────────────────────────────────────────────────

export interface HandleProviderEventInput {
  deliveryId: string;
  snapshot: ProviderSnapshot;
  source: 'PROVIDER' | 'CRON';
  /** Webhook event id; for a poll pass `poll:<hash>` so repeats dedupe. */
  providerEventId: string;
}

/**
 * Fold a provider webhook / poll snapshot into the state machine. `UNKNOWN`
 * snapshots are recorded (via `recordTransition`, which writes the event and
 * leaves state untouched) and logged. Must be called inside a tx.
 */
export async function handleProviderEvent(
  tx: FulfillmentTx,
  input: HandleProviderEventInput,
): Promise<RecordTransitionResult> {
  const { snapshot } = input;
  const toState: NormalizedState =
    snapshot.state === 'UNKNOWN' ? ('PENDING' as NormalizedState) : snapshot.state;

  if (snapshot.state === 'UNKNOWN') {
    log.warn('fulfillment: unknown provider status', {
      deliveryId: input.deliveryId,
      rawStatus: snapshot.rawStatus,
    });
    // still record the raw event, no state move
    await tx.deliveryEvent.create({
      data: {
        deliveryId: input.deliveryId,
        state: 'UNKNOWN',
        source: input.source,
        providerStatus: snapshot.rawStatus,
        providerEventId: input.providerEventId,
        payload: { rawStatus: snapshot.rawStatus } as Prisma.InputJsonValue,
      },
    });
    return { changed: false, deduped: false, state: toState };
  }

  const patch: Prisma.DeliveryUpdateInput = {
    ...(snapshot.providerDeliveryId ? { providerDeliveryId: snapshot.providerDeliveryId } : {}),
    ...(snapshot.trackingUrl ? { trackingUrl: snapshot.trackingUrl } : {}),
    ...(snapshot.estimatedPickupAt ? { estimatedPickupAt: snapshot.estimatedPickupAt } : {}),
    ...(snapshot.estimatedDropoffAt ? { estimatedDropoffAt: snapshot.estimatedDropoffAt } : {}),
    ...(snapshot.cancelReason ? { cancelReason: snapshot.cancelReason } : {}),
  };

  return recordTransition(tx, {
    deliveryId: input.deliveryId,
    toState,
    actor: input.source,
    providerEventId: input.providerEventId,
    providerStatus: snapshot.rawStatus,
    patch,
    payload: { rawStatus: snapshot.rawStatus } as Prisma.InputJsonValue,
  });
}

// ── selectProvider ───────────────────────────────────────────────────────

export interface ProviderChoiceInput {
  method: 'PICKUP' | 'DELIVERY';
  config: FulfillmentConfig;
  quotes: DeliveryQuote[];
  /** The buyer's pick, when `config.customerChoosesProvider` is on. */
  chosenProviderType?: ProviderType | null;
}

export interface ProviderChoice {
  ok: boolean;
  providerType?: ProviderType;
  quote?: DeliveryQuote;
  reason?: string;
}

/**
 * Decide which provider fulfills an order, given the store config + the
 * serviceable quotes gathered at checkout.
 *
 * - PICKUP: always PICKUP.
 * - DELIVERY + `customerChoosesProvider` + a valid `chosenProviderType`:
 *   honor it (must be serviceable).
 * - DELIVERY otherwise: the cheapest serviceable delivery quote.
 */
export function selectProvider(input: ProviderChoiceInput): ProviderChoice {
  if (input.method === 'PICKUP') {
    return { ok: true, providerType: 'PICKUP' };
  }

  const serviceable = input.quotes.filter((q) => q.serviceable && q.provider !== 'PICKUP');
  if (serviceable.length === 0) {
    return { ok: false, reason: 'No delivery method can service this address right now.' };
  }

  if (input.config.customerChoosesProvider && input.chosenProviderType) {
    const picked = serviceable.find((q) => q.provider === input.chosenProviderType);
    if (!picked) {
      return { ok: false, reason: 'That delivery option is no longer available.' };
    }
    return { ok: true, providerType: picked.provider, quote: picked };
  }

  const cheapest = serviceable.reduce((a, b) => (b.feeCents < a.feeCents ? b : a));
  return { ok: true, providerType: cheapest.provider, quote: cheapest };
}

// ── quoteMethod ──────────────────────────────────────────────────────────

/** Run one provider's `quote`, resolving any thrown error to an unserviceable
 *  result (providers already promise not to throw — this is belt-and-braces)
 *  and enforcing a timeout so one slow courier can't stall checkout. */
export async function quoteMethod(
  providerType: ProviderType,
  input: DeliveryQuoteInput,
  ctx: ProviderContext,
  timeoutMs: number,
): Promise<DeliveryQuote> {
  const provider = getDeliveryProvider(providerType, ctx);
  const unserviceable = (reason: string): DeliveryQuote => ({
    provider: providerType,
    serviceable: false,
    feeCents: 0,
    currency: input.currency,
    unserviceableReason: reason,
  });

  if (!provider.isConfigured()) return unserviceable('Not configured.');

  try {
    const timeout = new Promise<DeliveryQuote>((resolve) =>
      setTimeout(() => resolve(unserviceable('Quote timed out.')), timeoutMs),
    );
    return await Promise.race([provider.quote(input), timeout]);
  } catch (err) {
    log.warn('fulfillment: quote threw', {
      providerType,
      err: err instanceof Error ? err.message : String(err),
    });
    return unserviceable('Quote failed.');
  }
}

/** Simple singleton-style Prisma type export for the cron/route call sites. */
export type FulfillmentPrisma = PrismaClient;
