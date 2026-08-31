/**
 * DOORDASH (DoorDash Drive v2) adapter.
 *
 * Auth: a self-signed JWT (see `doordash-jwt.ts`) on every request. All calls
 * are plain `fetch` against `https://openapi.doordash.com/drive/v2` — DoorDash
 * has no official Node SDK for Drive. Sandbox uses the same host with sandbox
 * developer credentials (auto dasher simulation); `DOORDASH_SANDBOX=1` is
 * informational.
 *
 * `external_delivery_id` is Vendylio-controlled and stable: `vend_<deliveryId>`
 * for a real delivery. A `duplicate_delivery_id` conflict is treated as
 * "already created" — we GET the delivery and hydrate, never dispatch twice.
 */
import 'server-only';
import { randomUUID } from 'crypto';
import { log } from '@/lib/server/observability/log';
import type { FulfillmentProvider } from '../provider';
import type {
  CancelDeliveryResult,
  CreateDeliveryInput,
  CreateDeliveryResult,
  DeliveryQuote,
  DeliveryQuoteInput,
  ProviderSnapshot,
  ProviderStateOrUnknown,
} from '../types';
import { getDoorDashJwt, readDoorDashCredentials } from './doordash-jwt';

const BASE_URL = 'https://openapi.doordash.com/drive/v2';
const REQUEST_TIMEOUT_MS = 8000;
const QUOTE_TTL_MS = 5 * 60 * 1000;

export function isDoorDashConfigured(): boolean {
  return readDoorDashCredentials() !== null;
}

/** DoorDash Drive delivery status → normalized state. */
export function normalizeDoorDashStatus(raw: string): ProviderStateOrUnknown {
  switch (raw.toLowerCase()) {
    case 'created':
    case 'quote_accepted':
      return 'REQUESTED';
    case 'dasher_confirmed':
    case 'arrived_at_pickup':
      return 'CONFIRMED';
    case 'picked_up':
    case 'dasher_confirmed_pickup':
      return 'PICKED_UP';
    case 'en_route_to_dropoff':
    case 'arrived_at_dropoff':
      return 'OUT_FOR_DELIVERY';
    case 'delivered':
      return 'DELIVERED';
    case 'cancelled':
    case 'canceled':
      return 'CANCELLED';
    case 'delivery_attempt_failed':
    case 'returned':
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────

interface DoorDashError extends Error {
  status?: number;
  code?: string;
  duplicate?: boolean;
}

async function ddFetch<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${getDoorDashJwt()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    const e = new Error(
      err instanceof Error && err.name === 'AbortError'
        ? 'DoorDash request timed out'
        : `DoorDash request failed: ${err instanceof Error ? err.message : String(err)}`,
    ) as DoorDashError;
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!res.ok) {
    const code = typeof json.code === 'string' ? json.code : '';
    const message =
      typeof json.message === 'string' && json.message
        ? json.message
        : `DoorDash ${method} ${path} → ${res.status}`;
    const e = new Error(message) as DoorDashError;
    e.status = res.status;
    if (code) e.code = code;
    e.duplicate = res.status === 409 || code === 'duplicate_delivery_id';
    throw e;
  }
  return json as T;
}

/** Drop `undefined` values so a spread doesn't widen an exact-optional type. */
function defined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

// ── Shapes (partial — only what we read) ────────────────────────────────

interface DDQuote {
  fee?: number;
  currency?: string;
  pickup_time_estimated?: string;
  dropoff_time_estimated?: string;
}
interface DDDelivery {
  external_delivery_id?: string;
  delivery_status?: string;
  tracking_url?: string;
  fee?: number;
  currency?: string;
  pickup_time_estimated?: string;
  dropoff_time_estimated?: string;
  dasher_name?: string;
  dasher_dropoff_phone_number?: string;
  cancellation_reason?: string;
}

function formatAddress(addr: Record<string, unknown> | null): string | null {
  if (!addr) return null;
  const parts = ['street', 'city', 'state', 'zip']
    .map((k) => (typeof addr[k] === 'string' ? (addr[k] as string) : ''))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function toDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function snapshotFrom(d: DDDelivery): ProviderSnapshot {
  const raw = d.delivery_status ?? 'unknown';
  return {
    providerDeliveryId: d.external_delivery_id ?? null,
    rawStatus: raw,
    state: normalizeDoorDashStatus(raw),
    ...defined({
      trackingUrl: d.tracking_url,
      estimatedPickupAt: toDate(d.pickup_time_estimated),
      estimatedDropoffAt: toDate(d.dropoff_time_estimated),
      courierName: d.dasher_name,
      courierPhone: d.dasher_dropoff_phone_number,
      cancelReason: d.cancellation_reason,
    }),
  };
}

// ── Provider ─────────────────────────────────────────────────────────────

export function createDoorDashFulfillmentProvider(): FulfillmentProvider {
  return {
    type: 'DOORDASH',
    friendlyName: 'DoorDash',
    capabilities: {
      external: true,
      quotes: true,
      cancellation: true,
      webhooks: true,
      tracking: true,
    },
    isConfigured: isDoorDashConfigured,

    async quote(input: DeliveryQuoteInput): Promise<DeliveryQuote> {
      if (!isDoorDashConfigured()) {
        return unserviceable(input, 'DoorDash Drive is not configured.');
      }
      const pickup = input.pickupAddress;
      const dropoff = formatAddress(input.dropoffAddress);
      if (!pickup || !dropoff) return unserviceable(input, 'Missing pickup or dropoff address.');

      try {
        const q = await ddFetch<DDQuote>('POST', '/quotes', {
          external_delivery_id: `quote_${randomUUID()}`,
          pickup_address: pickup,
          ...(input.pickupPhone ? { pickup_phone_number: input.pickupPhone } : {}),
          dropoff_address: dropoff,
          ...(input.dropoffPhone ? { dropoff_phone_number: input.dropoffPhone } : {}),
          order_value: input.subtotalCents,
        });
        if (typeof q.fee !== 'number') return unserviceable(input, 'DoorDash returned no fee.');
        return {
          provider: 'DOORDASH',
          serviceable: true,
          feeCents: q.fee,
          currency: q.currency ?? input.currency,
          providerCostCents: q.fee,
          expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
          ...defined({
            estimatedPickupAt: toDate(q.pickup_time_estimated),
            estimatedDropoffAt: toDate(q.dropoff_time_estimated),
          }),
        };
      } catch (err) {
        const e = err as DoorDashError;
        log.warn('doordash quote failed', { status: e.status, code: e.code, msg: e.message });
        return unserviceable(
          input,
          e.status === 422
            ? 'This address is outside DoorDash coverage.'
            : 'DoorDash could not quote.',
        );
      }
    },

    async createDelivery(input: CreateDeliveryInput): Promise<CreateDeliveryResult> {
      const pickup = input.pickupAddress;
      const dropoff = formatAddress(input.dropoffAddress);
      if (!pickup) throw new Error('Set a pickup address before dispatching a DoorDash delivery.');
      if (!dropoff) throw new Error('This order has no delivery address for DoorDash.');

      const payload = {
        external_delivery_id: input.externalDeliveryId,
        pickup_address: pickup,
        pickup_business_name: input.storeName,
        ...(input.pickupPhone ? { pickup_phone_number: input.pickupPhone } : {}),
        dropoff_address: dropoff,
        ...(input.customerName ? { dropoff_contact_given_name: input.customerName } : {}),
        ...(input.customerPhone ? { dropoff_phone_number: input.customerPhone } : {}),
        order_value: input.subtotalCents,
        ...(input.manifestItems.length
          ? { items: input.manifestItems.map((i) => ({ name: i.name, quantity: i.quantity })) }
          : {}),
      };

      let d: DDDelivery;
      try {
        d = await ddFetch<DDDelivery>('POST', '/deliveries', payload);
      } catch (err) {
        const e = err as DoorDashError;
        if (e.duplicate) {
          // Already created (a retry / a lost response). Hydrate from GET.
          const existing = await ddFetch<DDDelivery>(
            'GET',
            `/deliveries/${encodeURIComponent(input.externalDeliveryId)}`,
          );
          const snap = snapshotFrom(existing);
          return {
            providerDeliveryId: existing.external_delivery_id ?? input.externalDeliveryId,
            state: snap.state === 'UNKNOWN' ? 'REQUESTED' : snap.state,
            deduplicated: true,
            ...defined({
              trackingUrl: snap.trackingUrl,
              estimatedPickupAt: snap.estimatedPickupAt,
              estimatedDropoffAt: snap.estimatedDropoffAt,
              providerCostCents: typeof existing.fee === 'number' ? existing.fee : undefined,
            }),
          };
        }
        throw err;
      }

      return {
        providerDeliveryId: d.external_delivery_id ?? input.externalDeliveryId,
        state: 'REQUESTED',
        ...defined({
          trackingUrl: d.tracking_url,
          estimatedPickupAt: toDate(d.pickup_time_estimated),
          estimatedDropoffAt: toDate(d.dropoff_time_estimated),
          providerCostCents: typeof d.fee === 'number' ? d.fee : undefined,
        }),
      };
    },

    async getDelivery(externalDeliveryId: string): Promise<ProviderSnapshot> {
      try {
        const d = await ddFetch<DDDelivery>(
          'GET',
          `/deliveries/${encodeURIComponent(externalDeliveryId)}`,
        );
        return snapshotFrom(d);
      } catch (err) {
        log.warn('doordash getDelivery failed', {
          externalDeliveryId,
          err: err instanceof Error ? err.message : String(err),
        });
        return { providerDeliveryId: null, rawStatus: 'unknown', state: 'UNKNOWN' };
      }
    },

    async cancelDelivery(externalDeliveryId: string): Promise<CancelDeliveryResult> {
      try {
        await ddFetch('PUT', `/deliveries/${encodeURIComponent(externalDeliveryId)}/cancel`);
        return { cancelled: true };
      } catch (err) {
        const e = err as DoorDashError;
        return {
          cancelled: false,
          reason:
            e.code === 'cancellation_not_allowed' || e.status === 422
              ? 'DoorDash will not cancel this delivery (a Dasher is already assigned).'
              : e.message,
        };
      }
    },

    normalizeStatus: normalizeDoorDashStatus,

    async testConnection() {
      if (!isDoorDashConfigured()) {
        return { ok: false, detail: 'DOORDASH_DEVELOPER_ID / _KEY_ID / _SIGNING_SECRET not set.' };
      }
      // GET a nonexistent delivery — a 404 proves the JWT authenticated and
      // never dispatches a driver.
      try {
        await ddFetch('GET', `/deliveries/vend_connection_test_${randomUUID()}`);
        return { ok: true, detail: 'Authenticated with DoorDash Drive.' };
      } catch (err) {
        const e = err as DoorDashError;
        if (e.status === 404) return { ok: true, detail: 'Authenticated with DoorDash Drive.' };
        if (e.status === 401 || e.status === 403) {
          return { ok: false, detail: `DoorDash rejected the credentials (${e.status}).` };
        }
        return { ok: false, detail: `DoorDash connection check failed: ${e.message}` };
      }
    },
  };
}

function unserviceable(input: DeliveryQuoteInput, reason: string): DeliveryQuote {
  return {
    provider: 'DOORDASH',
    serviceable: false,
    feeCents: 0,
    currency: input.currency,
    unserviceableReason: reason,
  };
}
