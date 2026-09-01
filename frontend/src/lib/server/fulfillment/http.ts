/**
 * Prompt #13 — shared request-timeout + error-classification helpers for the
 * fulfillment engine.
 *
 * Every outbound provider call (quote / create / get / cancel) must be
 * time-boxed: a hung courier API can otherwise stall a checkout, a cron tick,
 * or a merchant click indefinitely. The DoorDash adapter already does this
 * inline with `AbortController`; this module generalises the pattern so the
 * Uber path and the service layer share one implementation.
 */
import 'server-only';

export const PROVIDER_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.FULFILLMENT_PROVIDER_TIMEOUT_MS ?? 10_000) || 10_000,
);

/** Thrown when a provider call is aborted for exceeding its deadline. */
export class DeliveryTimeoutError extends Error {
  constructor(what = 'provider request') {
    super(`${what} timed out`);
    this.name = 'DeliveryTimeoutError';
  }
}

/**
 * `fetch` with a hard deadline. Aborts the request and throws
 * `DeliveryTimeoutError` when `ms` elapses; always clears its timer.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms: number = PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new DeliveryTimeoutError(`request to ${new URL(url).host}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Race an arbitrary promise (e.g. an SDK call with no abort support) against a
 * deadline. On timeout, resolves with `onTimeout()` when provided, otherwise
 * rejects with `DeliveryTimeoutError`. The underlying promise is not
 * cancelled — it just stops being awaited.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => T,
  label = 'provider request',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      if (onTimeout) resolve(onTimeout());
      else reject(new DeliveryTimeoutError(label));
    }, ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Error taxonomy ──────────────────────────────────────────────────────────

export const DELIVERY_ERROR_CODES = [
  'DELIVERY_TIMEOUT',
  'DELIVERY_INVALID_ADDRESS',
  'DELIVERY_NO_COURIER',
  'DELIVERY_RATE_LIMITED',
  'DELIVERY_AUTH_FAILED',
  'DELIVERY_PROVIDER_UNAVAILABLE',
] as const;
export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number];

const FRIENDLY: Record<DeliveryErrorCode, string> = {
  DELIVERY_TIMEOUT: 'The delivery provider did not respond in time. Try again in a moment.',
  DELIVERY_INVALID_ADDRESS:
    'The delivery address could not be serviced by the courier. Check the address and retry.',
  DELIVERY_NO_COURIER:
    'No courier is available for this delivery right now. Try again shortly or arrange delivery yourself.',
  DELIVERY_RATE_LIMITED: 'The delivery provider is rate-limiting us. Retry in a minute.',
  DELIVERY_AUTH_FAILED:
    'We could not authenticate with the delivery provider. This is a platform configuration issue — contact support.',
  DELIVERY_PROVIDER_UNAVAILABLE: 'The delivery provider is temporarily unavailable. Retry shortly.',
};

/**
 * Map a thrown provider error into a stable Vendylio code + a merchant-safe
 * message, so the frontend can switch on `ApiError.code` and never has to
 * parse a raw provider string. Never throws.
 */
export function classifyDeliveryError(err: unknown): { code: DeliveryErrorCode; message: string } {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  let code: DeliveryErrorCode = 'DELIVERY_PROVIDER_UNAVAILABLE';

  if (err instanceof DeliveryTimeoutError || /tim(e|ed)\s*out|abort|etimedout/.test(raw)) {
    code = 'DELIVERY_TIMEOUT';
  } else if (/\b429\b|rate.?limit|too many requests/.test(raw)) {
    code = 'DELIVERY_RATE_LIMITED';
  } else if (/\b401\b|\b403\b|unauthor|forbidden|invalid.*(token|credential|api key)/.test(raw)) {
    code = 'DELIVERY_AUTH_FAILED';
  } else if (/deliverable area|invalid address|address.*(invalid|not found)|geocod/.test(raw)) {
    code = 'DELIVERY_INVALID_ADDRESS';
  } else if (
    /no courier|no dasher|no_courier|no_dasher|unavailable courier|no drivers?/.test(raw)
  ) {
    code = 'DELIVERY_NO_COURIER';
  }

  return { code, message: FRIENDLY[code] };
}
