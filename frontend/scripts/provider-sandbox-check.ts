/**
 * PROMPT #13.5 — isolated REAL courier sandbox validation harness.
 *
 * Exercises the EXISTING provider adapters (`getDeliveryProvider(...)` from the
 * registry — no parallel client) against the real Uber Direct / DoorDash Drive
 * sandbox APIs, and prints the §42 result matrix.
 *
 * This is deliberately NOT a vitest file — `pnpm test` only discovers
 * `scripts/**\/*.test.ts`, so normal CI never runs it. It additionally refuses
 * to do anything unless `RUN_PROVIDER_SANDBOX_TESTS=1`.
 *
 *   Usage:  RUN_PROVIDER_SANDBOX_TESTS=1 pnpm --filter frontend provider:sandbox-check
 *   +create: also set RUN_PROVIDER_SANDBOX_CREATE=1  (creates → polls → cancels
 *            one sandbox delivery per configured+enabled courier)
 *
 * Safety (spec §38): aborts on NODE_ENV=production, and for the courier being
 * checked aborts unless its *_SANDBOX flag is set. Never prints a token/secret.
 *
 * Run via: tsx --conditions=react-server  (stubs the `server-only` marker so the
 * lib/server adapters import in plain Node — see package.json).
 */
import { pathToFileURL } from 'node:url';
import { getDeliveryProvider } from '@/lib/server/fulfillment/registry';
import type { CourierProviderType } from '@/lib/server/fulfillment/types';
import type { FulfillmentProvider } from '@/lib/server/fulfillment/provider';

type Result = 'PASS' | 'FAIL' | 'BLOCKED' | 'BLOCKED_BY_CREDENTIALS' | 'SKIPPED';
interface Row {
  provider: string;
  operation: string;
  result: Result;
  notes: string;
}

const rows: Row[] = [];
const add = (provider: string, operation: string, result: Result, notes = '') =>
  rows.push({ provider, operation, result, notes });

/** A known-serviceable US test route (Uber's own docs use this SF pair). */
const TEST_PICKUP = '425 Market St, San Francisco, CA 94105';
const TEST_DROPOFF_BLOB = {
  street: '201 3rd St',
  city: 'San Francisco',
  state: 'CA',
  zip: '94103',
};

function short(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 200 ? `${m.slice(0, 200)}…` : m;
}

async function checkCourier(
  type: CourierProviderType,
  sandboxFlag: string,
  credHint: string,
): Promise<void> {
  const label = type;
  const provider: FulfillmentProvider = getDeliveryProvider(type);

  if (!provider.isConfigured()) {
    add(label, 'Auth', 'BLOCKED_BY_CREDENTIALS', credHint);
    for (const op of ['Quote', 'Create', 'Status', 'Cancel']) {
      add(label, op, 'BLOCKED_BY_CREDENTIALS', 'no credentials');
    }
    return;
  }

  if (process.env[sandboxFlag] !== '1') {
    add(
      label,
      'Auth',
      'BLOCKED',
      `refusing to hit ${type} without ${sandboxFlag}=1 (prod-safety §38)`,
    );
    return;
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  let authOk = false;
  try {
    const probe = await provider.testConnection();
    authOk = probe.ok;
    add(label, 'Auth', probe.ok ? 'PASS' : 'FAIL', probe.detail);
  } catch (err) {
    add(label, 'Auth', 'FAIL', short(err));
  }

  // ── Quote ───────────────────────────────────────────────────────────────
  let quoteServiceable = false;
  try {
    const q = await provider.quote({
      pickupAddress: TEST_PICKUP,
      pickupPhone: '+15555550100',
      dropoffAddress: TEST_DROPOFF_BLOB,
      dropoffPhone: '+15555550111',
      subtotalCents: 2500,
      currency: 'USD',
    });
    quoteServiceable = q.serviceable;
    if (q.serviceable) {
      add(label, 'Quote', 'PASS', `feeCents=${q.feeCents} currency=${q.currency}`);
    } else {
      // The adapter swallows the provider error and returns unserviceable —
      // that's the safe checkout behaviour, but for validation it means we
      // could not confirm the live quote contract.
      add(label, 'Quote', 'BLOCKED', q.unserviceableReason ?? 'adapter returned unserviceable');
    }
  } catch (err) {
    add(label, 'Quote', 'FAIL', short(err));
  }

  // ── Create → Status → Cancel (opt-in) ──────────────────────────────────
  if (process.env.RUN_PROVIDER_SANDBOX_CREATE !== '1') {
    for (const op of ['Create', 'Status', 'Cancel']) {
      add(label, op, 'SKIPPED', 'set RUN_PROVIDER_SANDBOX_CREATE=1 to exercise');
    }
    return;
  }
  if (!authOk || !quoteServiceable) {
    for (const op of ['Create', 'Status', 'Cancel']) {
      add(label, op, 'BLOCKED', 'auth or quote did not pass — not creating a delivery');
    }
    return;
  }

  const externalDeliveryId = `vend_sandboxcheck_${Date.now()}`;
  let providerDeliveryId: string | null = null;
  try {
    const created = await provider.createDelivery({
      externalDeliveryId,
      orderId: externalDeliveryId,
      storeId: 'sandbox-check',
      storeName: 'Vendylio Sandbox Check',
      pickupAddress: TEST_PICKUP,
      pickupPhone: '+15555550100',
      customerName: 'Sandbox Tester',
      customerPhone: '+15555550111',
      dropoffAddress: TEST_DROPOFF_BLOB,
      subtotalCents: 2500,
      currency: 'USD',
      manifestItems: [{ name: 'Test item', quantity: 1 }],
    });
    providerDeliveryId = created.providerDeliveryId;
    add(label, 'Create', 'PASS', `state=${created.state} id=${providerDeliveryId ?? '<none>'}`);
  } catch (err) {
    add(label, 'Create', 'FAIL', short(err));
  }

  if (providerDeliveryId) {
    try {
      const snap = await provider.getDelivery(providerDeliveryId);
      add(label, 'Status', 'PASS', `raw="${snap.rawStatus}" → ${snap.state}`);
    } catch (err) {
      add(label, 'Status', 'FAIL', short(err));
    }
    try {
      const c = await provider.cancelDelivery(providerDeliveryId);
      add(
        label,
        'Cancel',
        c.cancelled ? 'PASS' : 'BLOCKED',
        c.cancelled ? 'cancelled' : (c.reason ?? 'provider refused'),
      );
    } catch (err) {
      add(label, 'Cancel', 'FAIL', short(err));
    }
  } else {
    add(label, 'Status', 'BLOCKED', 'no delivery id');
    add(label, 'Cancel', 'BLOCKED', 'no delivery id');
  }
}

function printMatrix(): void {
  const w = (s: string, n: number) => s.padEnd(n);
  console.log('');
  console.log(`| ${w('Provider', 12)} | ${w('Operation', 10)} | ${w('Result', 22)} | Notes`);
  console.log(`|${'-'.repeat(14)}|${'-'.repeat(12)}|${'-'.repeat(24)}|------`);
  for (const r of rows) {
    console.log(`| ${w(r.provider, 12)} | ${w(r.operation, 10)} | ${w(r.result, 22)} | ${r.notes}`);
  }
  console.log('');
}

export async function main(): Promise<number> {
  if (process.env.NODE_ENV === 'production') {
    console.error('ABORT: refusing to run the provider sandbox harness with NODE_ENV=production.');
    return 2;
  }
  if (process.env.RUN_PROVIDER_SANDBOX_TESTS !== '1') {
    console.error(
      'This harness makes REAL calls to courier sandbox APIs.\n' +
        'Set RUN_PROVIDER_SANDBOX_TESTS=1 to run it (see docs/fulfillment/sandbox-runbook.md).',
    );
    return 1;
  }

  console.log('PROMPT #13.5 — real courier sandbox validation');
  console.log(
    `  RUN_PROVIDER_SANDBOX_CREATE=${process.env.RUN_PROVIDER_SANDBOX_CREATE ?? '<unset>'}`,
  );

  await checkCourier(
    'UBER_DIRECT',
    'UBER_DIRECT_SANDBOX_TEST_MODE',
    'set UBER_DIRECT_CLIENT_ID / _CLIENT_SECRET / _CUSTOMER_ID',
  );
  await checkCourier(
    'DOORDASH',
    'DOORDASH_SANDBOX',
    'set DOORDASH_DEVELOPER_ID / _KEY_ID / _SIGNING_SECRET',
  );

  printMatrix();

  const failed = rows.filter((r) => r.result === 'FAIL');
  if (failed.length) {
    console.error(`${failed.length} operation(s) FAILED.`);
    return 1;
  }
  console.log(
    'No FAILs. BLOCKED / BLOCKED_BY_CREDENTIALS rows need an external dependency resolved.',
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
