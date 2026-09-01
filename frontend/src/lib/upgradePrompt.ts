// Phase 5 — surface a "go Pro" modal when a route returns a plan gate, without
// touching the PROTECTED lib/api.ts wrapper. A call site does:
//
//   catch (err) { if (!handleGateError(err)) setError(...) }
//
// `handleGateError` recognises the 402 gate codes and notifies every
// subscriber; `<UpgradeModalHost>` (mounted in the dashboard layout + the
// product-form pages) subscribes and shows the modal.
//
// A plain module-level listener registry — not DOM CustomEvents — so it works
// in the Node test env and doesn't couple this to `window`.
import { ApiError } from '@/lib/api';

const GATE_CODES = new Set([
  'PLAN_UPGRADE_REQUIRED',
  'AI_QUOTA_EXCEEDED',
  'PAYMENT_METHOD_REQUIRED',
]);

export interface UpgradeDetail {
  code: string;
  feature?: string;
  message: string;
}

type Listener = (detail: UpgradeDetail) => void;
const listeners = new Set<Listener>();

/** Subscribe to upgrade-needed notifications. Returns an unsubscribe fn. */
export function onUpgradeNeeded(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyUpgradeNeeded(detail: UpgradeDetail): void {
  for (const fn of listeners) fn(detail);
}

/** True (and a modal was triggered) when `err` is a recognised plan gate. */
export function handleGateError(err: unknown): boolean {
  if (err instanceof ApiError && GATE_CODES.has(err.code)) {
    const feature = typeof err.body.feature === 'string' ? err.body.feature : undefined;
    notifyUpgradeNeeded({
      code: err.code,
      ...(feature ? { feature } : {}),
      message: err.message,
    });
    return true;
  }
  return false;
}
