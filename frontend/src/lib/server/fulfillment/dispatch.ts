/**
 * Prompt #12 — the `fulfillment-tick` cron core (every ~2 min).
 *
 * Three jobs, all idempotent and safe to run concurrently with webhooks:
 *   A. DISPATCH — turn PENDING courier deliveries (whose order is READY) into
 *      real external deliveries via `createFulfillment`.
 *   B. POLL — read the provider's current view of every in-flight courier
 *      delivery and fold it through the state machine. This surfaces the
 *      intermediate "courier assigned / picked up / on the way" states without
 *      touching the PROTECTED webhook factory, and is a safety net for a
 *      missed terminal webhook.
 *   C. PURGE — drop stale `Quote` rows.
 */
import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { log } from '@/lib/server/observability/log';
import { createFulfillment, handleProviderEvent } from './service';
import { getDeliveryProvider } from './registry';
import { COURIER_PROVIDER_TYPES, type ProviderType } from './types';

const DISPATCH_BATCH = 25;
const POLL_BATCH = 50;
const QUOTE_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATES = ['REQUESTED', 'CONFIRMED', 'PICKED_UP', 'OUT_FOR_DELIVERY'];

export interface FulfillmentTickResult {
  dispatched: number;
  dispatchFailed: number;
  polled: number;
  pollAdvanced: number;
  quotesPurged: number;
}

export async function runFulfillmentTick(prisma: PrismaClient): Promise<FulfillmentTickResult> {
  const result: FulfillmentTickResult = {
    dispatched: 0,
    dispatchFailed: 0,
    polled: 0,
    pollAdvanced: 0,
    quotesPurged: 0,
  };

  // ── A. Dispatch PENDING courier deliveries for READY orders. ──
  const pending = await prisma.delivery.findMany({
    where: {
      state: 'PENDING',
      providerType: { in: COURIER_PROVIDER_TYPES as unknown as string[] },
      order: { status: 'READY' },
    },
    select: { id: true },
    take: DISPATCH_BATCH,
    orderBy: { createdAt: 'asc' },
  });

  for (const row of pending) {
    try {
      const r = await createFulfillment(prisma, row.id, { actor: 'SYSTEM' });
      if (r.dispatched) result.dispatched++;
      else if (r.error) result.dispatchFailed++;
    } catch (err) {
      result.dispatchFailed++;
      log.error('fulfillment-tick: dispatch threw', {
        deliveryId: row.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── B. Poll in-flight courier deliveries. ──
  const active = await prisma.delivery.findMany({
    where: {
      state: { in: ACTIVE_STATES },
      providerType: { in: COURIER_PROVIDER_TYPES as unknown as string[] },
      dispatchedAt: { not: null },
      externalDeliveryId: { not: null },
    },
    select: { id: true, providerType: true, externalDeliveryId: true },
    take: POLL_BATCH,
    orderBy: { updatedAt: 'asc' },
  });

  for (const row of active) {
    result.polled++;
    const provider = getDeliveryProvider(row.providerType as ProviderType);
    if (!provider.isConfigured()) continue;
    try {
      const snapshot = await provider.getDelivery(row.externalDeliveryId!);
      if (snapshot.state === 'UNKNOWN') continue;
      const res = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', row.id);
          return handleProviderEvent(tx, {
            deliveryId: row.id,
            snapshot,
            source: 'CRON',
            providerEventId: `poll:${snapshot.rawStatus}`,
          });
        },
        { isolationLevel: 'Serializable' },
      );
      if (res.changed) result.pollAdvanced++;
    } catch (err) {
      log.warn('fulfillment-tick: poll failed', {
        deliveryId: row.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── C. Purge stale quotes. ──
  const purged = await prisma.quote.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - QUOTE_TTL_MS) } },
  });
  result.quotesPurged = purged.count;

  return result;
}
