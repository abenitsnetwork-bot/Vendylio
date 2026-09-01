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
import { createHash } from 'crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaTransactionClient } from '@/lib/server/webhook/handler';
import { log } from '@/lib/server/observability/log';
import { canTransition, isTerminal, mapToOrderStatus } from './stateMachine';
import {
  classifyDeliveryError,
  withTimeout,
  PROVIDER_TIMEOUT_MS,
  type DeliveryErrorCode,
} from './http';
import type {
  DeliveryQuote,
  DeliveryQuoteInput,
  FulfillmentActor,
  NormalizedState,
  ProviderSnapshot,
  ProviderType,
} from './types';
import { getDeliveryProvider, type ProviderContext } from './registry';
import {
  enabledProviderTypes,
  readFulfillmentConfig,
  resolveOrderProviderType,
  type FulfillmentConfig,
} from './config';
import { PROVIDER_FRIENDLY_NAME } from './types';
import { createNotification } from '@/lib/server/notifications';
import {
  fulfillmentDispatched,
  fulfillmentSetupFailed,
} from '@/lib/server/notifications/templates';
import { formatOrderNumber } from '@/lib/orderNumber';
import { enqueueOutbox } from '@/lib/server/outbox';
import { isCourierProvider } from './types';

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

  // 4. Map to Order.status. The lookup is widened to also carry the store
  //    owner, reused below for the terminal side-effects (one query).
  const map = mapToOrderStatus(input.toState);
  let ownerId: string | null = null;
  if (map.target) {
    const order = await tx.order.findUnique({
      where: { id: delivery.orderId },
      select: {
        status: true,
        store: { select: { organization: { select: { ownerId: true } } } },
      },
    });
    ownerId = order?.store?.organization?.ownerId ?? null;
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

  // 5. Terminal side-effects — the ONE funnel (Prompt #13 R1). Because
  //    `canTransition` blocks every terminal→* move and we only get here when
  //    the state actually changed, this fires exactly once per delivery across
  //    every path: courier webhook, poll cron, retry-route reconcile, and a
  //    merchant self-delivery "Mark delivered" click.
  if (isTerminal(input.toState)) {
    await enqueueDeliveryTerminalEffects(tx, {
      orderId: delivery.orderId,
      ownerId,
      finalState: input.toState,
      rawStatus: input.providerStatus ?? null,
      actor: input.actor,
    });
  }

  return { changed: true, deduped: false, state: input.toState };
}

/**
 * Enqueue the seller notification + the customer status email for a delivery
 * that just reached a terminal state. Called from `recordTransition` only.
 *
 * - DELIVERED (any actor): "delivered" notification + email.
 * - FAILED / CANCELLED from PROVIDER or CRON (i.e. the courier failed/cancelled
 *   it, or a poll discovered that): "delivery issue" notification + email.
 * - FAILED / CANCELLED from MERCHANT or SYSTEM: the seller initiated it (manual
 *   cancel, or a dispatch that exhausted retries — which already sends its own
 *   `FULFILLMENT_FAILED` seller notification) → no customer-facing email.
 */
async function enqueueDeliveryTerminalEffects(
  tx: FulfillmentTx,
  input: {
    orderId: string;
    ownerId: string | null;
    finalState: NormalizedState;
    rawStatus: string | null;
    actor: FulfillmentActor;
  },
): Promise<void> {
  const { orderId, ownerId, finalState, rawStatus, actor } = input;
  const courierEnded = actor === 'PROVIDER' || actor === 'CRON';

  if (finalState === 'DELIVERED') {
    if (ownerId) {
      await enqueueOutbox(tx, {
        kind: 'notification.delivery_completed',
        payload: { userId: ownerId, orderId },
      });
    }
    await enqueueOutbox(tx, {
      kind: 'email.order_status',
      payload: { orderId, kind: 'DELIVERED' },
    });
    return;
  }

  // FAILED | CANCELLED
  if (!courierEnded) return;
  if (ownerId) {
    await enqueueOutbox(tx, {
      kind: 'notification.delivery_failed',
      payload: { userId: ownerId, orderId, status: rawStatus ?? finalState },
    });
  }
  await enqueueOutbox(tx, {
    kind: 'email.order_status',
    payload: { orderId, kind: 'DELIVERY_ISSUE' },
  });
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

// ── applyCourierWebhookEvent ────────────────────────────────────────────

/**
 * The single entry point both courier webhook routes
 * (`api/webhooks/{uber-direct,doordash}`) funnel through. Correlates the
 * payload to a `Delivery`, folds the status through `handleProviderEvent`
 * (state machine + `DeliveryEvent` idempotency), and — only when the state
 * actually moved to a terminal — enqueues the seller notification + the
 * customer status email inside the factory's Serializable tx.
 */
export async function applyCourierWebhookEvent(
  tx: FulfillmentTx,
  input: {
    providerType: ProviderType;
    correlateBy: { externalDeliveryId: string } | { providerDeliveryId: string };
    rawStatus: string;
    eventId: string;
  },
): Promise<{ matched: boolean; changed: boolean; state?: NormalizedState }> {
  const delivery = await tx.delivery.findFirst({
    where: input.correlateBy,
    select: { id: true },
  });
  if (!delivery) return { matched: false, changed: false };

  // Prompt #13 (Y3): serialize against a concurrent retry / poll on the same
  // delivery, same lock `createFulfillment` and the poll cron take. The
  // webhook factory's Serializable tx already prevents corruption; the lock
  // makes contention deterministic instead of abort-and-retry.
  await lockDeliveryTx(tx, delivery.id);

  const normalized = getDeliveryProvider(input.providerType).normalizeStatus(input.rawStatus);
  // The terminal seller-notification + customer email are enqueued by
  // `recordTransition` → `enqueueDeliveryTerminalEffects` (Prompt #13 R1), the
  // single funnel every path shares — this route no longer emits them itself.
  const res = await handleProviderEvent(tx, {
    deliveryId: delivery.id,
    snapshot: { providerDeliveryId: null, rawStatus: input.rawStatus, state: normalized },
    source: 'PROVIDER',
    providerEventId: input.eventId,
  });

  return { matched: true, changed: res.changed, state: res.state };
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
    return await withTimeout(
      provider.quote(input),
      timeoutMs,
      () => unserviceable('Quote timed out.'),
      `${providerType} quote`,
    );
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

// ── createQuote ─────────────────────────────────────────────────────────

/** Stable hash binding a persisted quote to the exact dropoff address it was
 *  produced for — checked again at `POST /api/orders`. */
export function hashDropoffAddress(addr: Record<string, unknown> | null): string {
  const norm = ['street', 'city', 'state', 'zip']
    .map((k) =>
      String(addr?.[k] ?? '')
        .trim()
        .toLowerCase(),
    )
    .join('|');
  return createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

const QUOTE_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.FULFILLMENT_QUOTE_TIMEOUT_MS ?? 4000) || 4000,
);
const FLAT_QUOTE_TTL_MS =
  Math.max(60, Number(process.env.FULFILLMENT_QUOTE_FALLBACK_TTL_SECONDS ?? 300) || 300) * 1000;

export interface CreateQuoteInput {
  storeId: string;
  config: FulfillmentConfig;
  pickupAddress: string | null;
  pickupPhone: string | null;
  dropoffAddress: Record<string, unknown> | null;
  dropoffPhone: string | null;
  subtotalCents: number;
  currency: string;
}

export interface QuoteOption {
  method: 'DELIVERY' | 'PICKUP';
  provider: ProviderType;
  friendlyName: string;
  quoteId: string | null;
  feeCents: number;
  serviceable: boolean;
  isEstimate: boolean;
  estimatedDropoffAt: string | null;
  expiresAt: string | null;
  unserviceableReason?: string;
}

export interface CreateQuoteResult {
  batchId: string;
  currency: string;
  customerChoosesProvider: boolean;
  options: QuoteOption[];
  /** No serviceable delivery method — checkout should steer to pickup. */
  deliveryUnavailable: boolean;
  /** A courier was tried and reported the address out of coverage. */
  notServiceable: boolean;
}

/**
 * Gather quotes from every enabled + configured provider in parallel (bounded
 * timeout, partial failure tolerated), persist one `Quote` row per serviceable
 * delivery result, and return the checkout options. PICKUP is always offered
 * when the store enables it.
 */
export async function createQuote(
  prisma: PrismaClient,
  input: CreateQuoteInput,
): Promise<CreateQuoteResult> {
  const batchId = createHash('sha256')
    .update(`${input.storeId}:${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 24);
  const dropoffAddressHash = hashDropoffAddress(input.dropoffAddress);

  const ctx: ProviderContext = { merchant: input.config.merchant, pickup: input.config.pickup };
  const quoteInput = {
    pickupAddress: input.pickupAddress,
    pickupPhone: input.pickupPhone,
    dropoffAddress: input.dropoffAddress,
    dropoffPhone: input.dropoffPhone,
    subtotalCents: input.subtotalCents,
    currency: input.currency,
  };

  const deliveryTypes = enabledProviderTypes(input.config).filter(
    (t) => t !== 'PICKUP' && getDeliveryProvider(t, ctx).isConfigured(),
  );

  const quotes = await Promise.all(
    deliveryTypes.map(async (t) => ({
      type: t,
      quote: await quoteMethod(t, quoteInput, ctx, QUOTE_TIMEOUT_MS),
    })),
  );

  const options: QuoteOption[] = [];
  let courierTried = false;

  for (const { type, quote } of quotes) {
    if (isCourierProvider(type)) courierTried = true;
    if (!quote.serviceable) {
      options.push({
        method: 'DELIVERY',
        provider: type,
        friendlyName: PROVIDER_FRIENDLY_NAME[type],
        quoteId: null,
        feeCents: 0,
        serviceable: false,
        isEstimate: false,
        estimatedDropoffAt: null,
        expiresAt: null,
        ...(quote.unserviceableReason ? { unserviceableReason: quote.unserviceableReason } : {}),
      });
      continue;
    }
    const isEstimate = !isCourierProvider(type);
    const expiresAt = quote.expiresAt ?? new Date(Date.now() + FLAT_QUOTE_TTL_MS);
    const row = await prisma.quote.create({
      data: {
        batchId,
        storeId: input.storeId,
        providerType: type,
        serviceable: true,
        feeCents: quote.feeCents,
        currency: quote.currency,
        ...(typeof quote.providerCostCents === 'number'
          ? { providerCostCents: quote.providerCostCents }
          : {}),
        ...(quote.providerQuoteId ? { providerQuoteId: quote.providerQuoteId } : {}),
        ...(quote.estimatedPickupAt ? { estimatedPickupAt: quote.estimatedPickupAt } : {}),
        ...(quote.estimatedDropoffAt ? { estimatedDropoffAt: quote.estimatedDropoffAt } : {}),
        expiresAt,
        subtotalCents: input.subtotalCents,
        dropoffAddressHash,
      },
      select: { id: true },
    });
    options.push({
      method: 'DELIVERY',
      provider: type,
      friendlyName: PROVIDER_FRIENDLY_NAME[type],
      quoteId: row.id,
      feeCents: quote.feeCents,
      serviceable: true,
      isEstimate,
      estimatedDropoffAt: quote.estimatedDropoffAt ? quote.estimatedDropoffAt.toISOString() : null,
      expiresAt: expiresAt.toISOString(),
    });
  }

  if (input.config.pickup.enabled) {
    options.push({
      method: 'PICKUP',
      provider: 'PICKUP',
      friendlyName: PROVIDER_FRIENDLY_NAME.PICKUP,
      quoteId: null,
      feeCents: 0,
      serviceable: true,
      isEstimate: false,
      estimatedDropoffAt: null,
      expiresAt: null,
    });
  }

  const serviceableDelivery = options.some((o) => o.method === 'DELIVERY' && o.serviceable);

  return {
    batchId,
    currency: input.currency,
    customerChoosesProvider: input.config.customerChoosesProvider,
    options,
    deliveryUnavailable: !serviceableDelivery,
    notServiceable: !serviceableDelivery && courierTried,
  };
}

// ── priceDeliveryForOrder ───────────────────────────────────────────────

export interface PriceDeliveryInput {
  store: {
    id: string;
    fulfillmentConfig: unknown;
    deliveryProvider: string;
    deliveryFeeCents: number;
    pickupAddress: string | null;
    phone: string | null;
  };
  /** The `Quote` row id the buyer selected at checkout, if any. */
  quoteId?: string | null;
  /** The buyer's provider pick (only honored when the store allows it). */
  chosenProviderType?: string | null;
  deliveryAddress: Record<string, unknown> | null;
  customerPhone: string | null;
  subtotalCents: number;
  currency: string;
}

export type PriceDeliveryResult =
  | {
      ok: true;
      feeCents: number;
      providerType: ProviderType;
      deliveryQuoteId: string | null;
      providerQuoteId: string | null;
      quoteExpiresAt: Date | null;
      providerCostCents: number | null;
    }
  | { ok: false; code: 'DELIVERY_QUOTE_INVALID' | 'DELIVERY_UNAVAILABLE'; message: string };

/**
 * The authoritative delivery-fee computation for `POST /api/orders`. Never
 * trusts a browser-sent fee.
 *
 * - With a `quoteId`: bind-checks the persisted `Quote` (store + cart + address
 *   hash). A courier quote — or any expired quote — is **re-quoted live**; if
 *   the courier is now unserviceable → `DELIVERY_UNAVAILABLE` (checkout offers
 *   pickup / a new address). A fresh flat (merchant) quote is used as-is.
 * - Without a `quoteId`: resolves the provider from the store config + the
 *   buyer's pick and quotes it live, falling back to the merchant flat fee.
 */
export async function priceDeliveryForOrder(
  prisma: PrismaClient,
  input: PriceDeliveryInput,
): Promise<PriceDeliveryResult> {
  const cfg = readFulfillmentConfig({
    fulfillmentConfig: input.store.fulfillmentConfig ?? {},
    deliveryProvider: input.store.deliveryProvider,
    deliveryFeeCents: input.store.deliveryFeeCents,
  });
  const ctx: ProviderContext = { merchant: cfg.merchant, pickup: cfg.pickup };
  const quoteInput: DeliveryQuoteInput = {
    pickupAddress: input.store.pickupAddress,
    pickupPhone: input.store.phone,
    dropoffAddress: input.deliveryAddress,
    dropoffPhone: input.customerPhone,
    subtotalCents: input.subtotalCents,
    currency: input.currency,
  };
  const dropoffHash = hashDropoffAddress(input.deliveryAddress);

  const liveQuote = async (providerType: ProviderType): Promise<PriceDeliveryResult> => {
    const q = await quoteMethod(providerType, quoteInput, ctx, QUOTE_TIMEOUT_MS);
    if (!q.serviceable) {
      if (isCourierProvider(providerType)) {
        return {
          ok: false,
          code: 'DELIVERY_UNAVAILABLE',
          message: q.unserviceableReason ?? 'This delivery method is not available right now.',
        };
      }
      // A merchant flat fee that came back "unserviceable" means the cart is
      // below the minimum order — a hard stop, same as a courier.
      return {
        ok: false,
        code: 'DELIVERY_UNAVAILABLE',
        message: q.unserviceableReason ?? 'Delivery is not available for this order.',
      };
    }
    return {
      ok: true,
      feeCents: q.feeCents,
      providerType,
      deliveryQuoteId: input.quoteId ?? null,
      providerQuoteId: q.providerQuoteId ?? null,
      quoteExpiresAt: q.expiresAt ?? null,
      providerCostCents: typeof q.providerCostCents === 'number' ? q.providerCostCents : null,
    };
  };

  if (input.quoteId) {
    const quote = await prisma.quote.findUnique({ where: { id: input.quoteId } });
    if (
      !quote ||
      quote.storeId !== input.store.id ||
      quote.subtotalCents !== input.subtotalCents ||
      quote.dropoffAddressHash !== dropoffHash
    ) {
      return {
        ok: false,
        code: 'DELIVERY_QUOTE_INVALID',
        message: 'Your delivery quote is no longer valid — please review your cart.',
      };
    }
    const providerType = quote.providerType as ProviderType;
    // Prompt #13 (R2): the store may have switched this method off between the
    // quote and the pay — never dispatch through a disabled provider.
    if (!enabledProviderTypes(cfg).includes(providerType)) {
      return {
        ok: false,
        code: 'DELIVERY_UNAVAILABLE',
        message: 'That delivery method is no longer offered by this store — please pick another.',
      };
    }
    const expired = quote.expiresAt ? quote.expiresAt.getTime() < Date.now() : false;
    if (isCourierProvider(providerType) || expired) {
      return liveQuote(providerType);
    }
    return {
      ok: true,
      feeCents: quote.feeCents,
      providerType,
      deliveryQuoteId: quote.id,
      providerQuoteId: quote.providerQuoteId ?? null,
      quoteExpiresAt: quote.expiresAt ?? null,
      providerCostCents: quote.providerCostCents ?? null,
    };
  }

  // No persisted quote (a legacy client, or a store with no courier chosen).
  // Quote the resolved provider live, but NEVER fail the checkout on it — a
  // missed live quote falls back to the store's flat fee, same principle the
  // Phase-5 checkout used. (The strict "quote expired → 409" path only applies
  // when the buyer actually selected a persisted quote.)
  const providerType = resolveOrderProviderType(input.chosenProviderType ?? null, cfg);
  const live = await liveQuote(providerType);
  if (live.ok) return live;
  return {
    ok: true,
    feeCents: cfg.merchant.feeCents,
    providerType,
    deliveryQuoteId: null,
    providerQuoteId: null,
    quoteExpiresAt: null,
    providerCostCents: null,
  };
}

// ── createFulfillment (courier dispatch) ─────────────────────────────────

export const DISPATCH_MAX_ATTEMPTS = Math.max(
  1,
  Number(process.env.FULFILLMENT_DISPATCH_MAX_ATTEMPTS ?? 6) || 6,
);

/** Transaction-scoped advisory lock, keyed on the deliveryId — serializes
 *  two workers that both try to dispatch / mutate the same delivery. */
async function lockDeliveryTx(tx: FulfillmentTx, deliveryId: string): Promise<void> {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', deliveryId);
}

interface DeliveryWithContext {
  id: string;
  orderId: string;
  state: NormalizedState;
  providerType: ProviderType | null;
  externalDeliveryId: string | null;
  providerDeliveryId: string | null;
  dispatchedAt: Date | null;
  attemptCount: number;
  order: {
    id: string;
    orderNumber: number;
    status: string;
    amount: number;
    currency: string;
    customerName: string | null;
    customerPhone: string | null;
    deliveryAddress: unknown;
    lineItems: unknown;
    storeId: string;
    store: {
      name: string;
      phone: string | null;
      pickupAddress: string | null;
      deliveryProvider: string;
      deliveryFeeCents: number;
      fulfillmentConfig: unknown;
      organization: { ownerId: string };
    };
  };
}

const DELIVERY_CTX_SELECT = {
  id: true,
  orderId: true,
  state: true,
  providerType: true,
  externalDeliveryId: true,
  providerDeliveryId: true,
  dispatchedAt: true,
  attemptCount: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      amount: true,
      currency: true,
      customerName: true,
      customerPhone: true,
      deliveryAddress: true,
      lineItems: true,
      storeId: true,
      store: {
        select: {
          name: true,
          phone: true,
          pickupAddress: true,
          deliveryProvider: true,
          deliveryFeeCents: true,
          fulfillmentConfig: true,
          organization: { select: { ownerId: true } },
        },
      },
    },
  },
} as const;

function providerCtxFor(store: DeliveryWithContext['order']['store']): ProviderContext {
  const cfg = readFulfillmentConfig({
    fulfillmentConfig: store.fulfillmentConfig ?? {},
    deliveryProvider: store.deliveryProvider,
    deliveryFeeCents: store.deliveryFeeCents,
  });
  return { merchant: cfg.merchant, pickup: cfg.pickup };
}

function manifestItemsFrom(lineItems: unknown): { name: string; quantity: number }[] {
  if (!Array.isArray(lineItems)) return [];
  return lineItems.map((li) => {
    const item = li as { name?: unknown; quantity?: unknown };
    return {
      name: typeof item.name === 'string' ? item.name : 'Item',
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
    };
  });
}

export interface CreateFulfillmentOptions {
  actor?: FulfillmentActor;
  /** Merchant "Request delivery" / "Retry" — re-check a courier delivery even
   *  when the row isn't PENDING (reconciles, never re-creates). */
  force?: boolean;
}

export interface CreateFulfillmentResult {
  state: NormalizedState;
  /** True when a courier delivery was actually requested this call. */
  dispatched: boolean;
  /** Merchant-safe message when the courier request failed this call. */
  error?: string;
  /** Stable Vendylio error code (Prompt #13 Y4) — switch on this, not `error`. */
  code?: DeliveryErrorCode;
}

/**
 * Dispatch one delivery. Opens its own Serializable tx + advisory lock.
 *
 * - MERCHANT / PICKUP: PENDING → REQUESTED, no external call.
 * - Courier, already has an `externalDeliveryId`: reconcile via `getDelivery`
 *   (never create a second delivery).
 * - Courier, fresh: stamp `externalDeliveryId = vend_<id>`, call
 *   `createDelivery`. On failure bump `attemptCount`; at `DISPATCH_MAX_ATTEMPTS`
 *   move to FAILED + notify the merchant (recoverable via the retry route).
 */
export async function createFulfillment(
  prisma: PrismaClient,
  deliveryId: string,
  opts: CreateFulfillmentOptions = {},
): Promise<CreateFulfillmentResult> {
  const actor: FulfillmentActor = opts.actor ?? 'SYSTEM';

  return prisma.$transaction(
    async (tx) => {
      await lockDeliveryTx(tx, deliveryId);

      const delivery = (await tx.delivery.findUnique({
        where: { id: deliveryId },
        select: DELIVERY_CTX_SELECT,
      })) as DeliveryWithContext | null;
      if (!delivery) throw new Error(`createFulfillment: no Delivery ${deliveryId}`);

      const providerType = delivery.providerType ?? 'MERCHANT';
      const store = delivery.order.store;
      const provider = getDeliveryProvider(providerType, providerCtxFor(store));

      // ── Non-external providers: advance the state, no courier call. A
      //    MERCHANT "Request delivery" click means the seller is heading out,
      //    so it goes straight to OUT_FOR_DELIVERY (two-click dashboard flow). ──
      if (!isCourierProvider(providerType)) {
        const target: NormalizedState =
          providerType === 'MERCHANT' ? 'OUT_FOR_DELIVERY' : 'REQUESTED';
        if (delivery.state === 'PENDING') {
          await recordTransition(tx, {
            deliveryId,
            toState: target,
            actor,
            patch: { dispatchedAt: new Date() },
          });
        }
        return { state: target, dispatched: false };
      }

      // ── Courier already dispatched (a real external delivery exists) →
      //    reconcile from the provider, never create a second one. ──
      if (delivery.dispatchedAt && delivery.externalDeliveryId) {
        try {
          const snapshot = await withTimeout(
            provider.getDelivery(delivery.providerDeliveryId ?? delivery.externalDeliveryId),
            PROVIDER_TIMEOUT_MS,
            undefined,
            `${providerType} getDelivery`,
          );
          if (snapshot.state !== 'UNKNOWN') {
            const res = await handleProviderEvent(tx, {
              deliveryId,
              snapshot,
              source: 'CRON',
              providerEventId: `reconcile:${Date.now()}`,
            });
            return { state: res.state, dispatched: false };
          }
        } catch (err) {
          log.warn('fulfillment: reconcile getDelivery failed', {
            deliveryId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        return { state: delivery.state, dispatched: false };
      }

      if (delivery.state !== 'PENDING' && !opts.force) {
        return { state: delivery.state, dispatched: false };
      }

      // ── Courier: fresh dispatch. Persist the stable external id first so a
      //    later retry can GET-reconcile if the create half-succeeded. ──
      const externalDeliveryId = delivery.externalDeliveryId ?? `vend_${deliveryId}`;
      await tx.delivery.update({ where: { id: deliveryId }, data: { externalDeliveryId } });

      try {
        const result = await withTimeout(
          provider.createDelivery({
            externalDeliveryId,
            orderId: delivery.orderId,
            storeId: delivery.order.storeId,
            storeName: store.name,
            pickupAddress: store.pickupAddress,
            pickupPhone: store.phone,
            customerName: delivery.order.customerName,
            customerPhone: delivery.order.customerPhone,
            dropoffAddress:
              (delivery.order.deliveryAddress as Record<string, unknown> | null) ?? null,
            subtotalCents: delivery.order.amount,
            currency: delivery.order.currency,
            manifestItems: manifestItemsFrom(delivery.order.lineItems),
          }),
          PROVIDER_TIMEOUT_MS,
          undefined,
          `${providerType} createDelivery`,
        );

        await recordTransition(tx, {
          deliveryId,
          toState: result.state,
          actor,
          patch: {
            dispatchedAt: new Date(),
            attemptCount: { increment: 1 },
            ...(result.providerDeliveryId ? { providerDeliveryId: result.providerDeliveryId } : {}),
            ...(result.trackingUrl ? { trackingUrl: result.trackingUrl } : {}),
            ...(result.estimatedPickupAt ? { estimatedPickupAt: result.estimatedPickupAt } : {}),
            ...(result.estimatedDropoffAt ? { estimatedDropoffAt: result.estimatedDropoffAt } : {}),
          },
        });

        await createNotification(
          tx as unknown as PrismaClient,
          fulfillmentDispatched(
            store.organization.ownerId,
            delivery.orderId,
            provider.friendlyName,
            formatOrderNumber(delivery.order.orderNumber),
          ),
        );

        return { state: 'REQUESTED', dispatched: true };
      } catch (err) {
        // Prompt #13 (Y4): map the raw provider error to a stable code +
        // merchant-safe message. `failureReason` stores the code so the
        // dashboard / retry route never surface a raw provider string.
        const { code, message } = classifyDeliveryError(err);
        const attempts = delivery.attemptCount + 1;
        const giveUp = attempts >= DISPATCH_MAX_ATTEMPTS;

        log.warn('fulfillment: dispatch failed', {
          deliveryId,
          orderId: delivery.orderId,
          providerType,
          code,
          attempts,
          giveUp,
          err: err instanceof Error ? err.message : String(err),
        });

        if (giveUp) {
          await recordTransition(tx, {
            deliveryId,
            toState: 'FAILED',
            actor,
            patch: { attemptCount: attempts, failureReason: code },
          });
          await createNotification(
            tx as unknown as PrismaClient,
            fulfillmentSetupFailed(
              store.organization.ownerId,
              delivery.orderId,
              message,
              formatOrderNumber(delivery.order.orderNumber),
            ),
          );
        } else {
          // stay PENDING; the cron retries with the bumped attemptCount.
          await tx.delivery.update({
            where: { id: deliveryId },
            data: { attemptCount: attempts, failureReason: code },
          });
        }
        return { state: giveUp ? 'FAILED' : 'PENDING', dispatched: false, error: message, code };
      }
    },
    { isolationLevel: 'Serializable' },
  );
}

// ── updateFulfillment (merchant quick actions) ──────────────────────────

export async function updateFulfillment(
  prisma: PrismaClient,
  deliveryId: string,
  toState: NormalizedState,
  actor: FulfillmentActor = 'MERCHANT',
): Promise<RecordTransitionResult> {
  return prisma.$transaction(
    async (tx) => {
      await lockDeliveryTx(tx, deliveryId);
      return recordTransition(tx, { deliveryId, toState, actor });
    },
    { isolationLevel: 'Serializable' },
  );
}

// ── cancelFulfillment ──────────────────────────────────────────────────

export interface CancelFulfillmentResult {
  cancelled: boolean;
  reason?: string;
  state?: NormalizedState;
}

export async function cancelFulfillment(
  prisma: PrismaClient,
  deliveryId: string,
  opts: { actor?: FulfillmentActor; reason?: string } = {},
): Promise<CancelFulfillmentResult> {
  const actor: FulfillmentActor = opts.actor ?? 'MERCHANT';

  return prisma.$transaction(
    async (tx) => {
      await lockDeliveryTx(tx, deliveryId);
      const delivery = (await tx.delivery.findUnique({
        where: { id: deliveryId },
        select: DELIVERY_CTX_SELECT,
      })) as DeliveryWithContext | null;
      if (!delivery) throw new Error(`cancelFulfillment: no Delivery ${deliveryId}`);

      if (delivery.state === 'CANCELLED' || delivery.state === 'DELIVERED') {
        return {
          cancelled: false,
          reason: `Delivery is already ${delivery.state}.`,
          state: delivery.state,
        };
      }

      const providerType = delivery.providerType ?? 'MERCHANT';
      const provider = getDeliveryProvider(providerType, providerCtxFor(delivery.order.store));

      if (isCourierProvider(providerType) && delivery.externalDeliveryId) {
        const res = await provider.cancelDelivery(
          delivery.providerDeliveryId ?? delivery.externalDeliveryId,
        );
        if (!res.cancelled) {
          return {
            cancelled: false,
            reason: res.reason ?? 'The courier will not cancel this delivery.',
            state: delivery.state,
          };
        }
      }

      const t = await recordTransition(tx, {
        deliveryId,
        toState: 'CANCELLED',
        actor,
        patch: opts.reason ? { cancelReason: opts.reason } : {},
      });
      return { cancelled: true, state: t.state };
    },
    { isolationLevel: 'Serializable' },
  );
}
