// Prompt #12 — fulfillment security sweep. Cross-cutting invariants that don't
// belong to one unit's test file. Per-route IDOR / signature / dedupe checks
// live in the individual route test files.
import { describe, it, expect } from 'vitest';
import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashDropoffAddress } from './service';

const ROOT = resolve(__dirname, '../../../..');

describe('provider credentials never leak to the client', () => {
  const files = fg.sync('src/**/*.{ts,tsx}', {
    cwd: ROOT,
    absolute: true,
    ignore: ['src/lib/server/**', '**/*.test.ts', '**/*.test.tsx'],
  });

  it('no DOORDASH_ / UBER_DIRECT_ env reference outside lib/server', () => {
    const offenders = files.filter((f) =>
      /process\.env\.(DOORDASH_|UBER_DIRECT_)/.test(readFileSync(f, 'utf8')),
    );
    expect(
      offenders.map((f) => f.replace(ROOT + '/', '')),
      'courier credentials must only be read inside lib/server',
    ).toEqual([]);
  });
});

describe('the checkout fee is authoritative, not client-supplied', () => {
  it('POST /api/orders never reads a fee/total from the request body', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/api/orders/route.ts'), 'utf8');
    // The client may send an address + a quoteId; it must never send money.
    expect(src).not.toMatch(/body\.(deliveryFee|deliveryFeeCents|providerFee|totalDeliveryCost)/);
    expect(src).toMatch(/priceDeliveryForOrder\(/);
  });

  it('binds a quote to its exact dropoff address', () => {
    const a = hashDropoffAddress({ street: '1 A St', city: 'X', state: 'Y', zip: '1' });
    const b = hashDropoffAddress({ street: '2 B St', city: 'X', state: 'Y', zip: '1' });
    expect(a).not.toBe(b);
    expect(a).toBe(hashDropoffAddress({ street: '1 a st', city: 'x', state: 'y', zip: '1' }));
  });
});

describe('the delivery provider is a server decision, not a client claim (Prompt #13 R2)', () => {
  it('POST /api/orders stores the priced provider, never the raw body value', () => {
    const src = readFileSync(resolve(ROOT, 'src/app/api/orders/route.ts'), 'utf8');
    // the persisted provider type comes from priceDeliveryForOrder's result…
    expect(src).toMatch(/deliveryProviderType\s*=\s*priced\.providerType/);
    // …never assigned straight from the request body
    expect(src).not.toMatch(/deliveryProviderType:\s*body\./);
  });

  it('resolveOrderProviderType only honours an enabled provider', () => {
    const src = readFileSync(resolve(ROOT, 'src/lib/server/fulfillment/config.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function resolveOrderProviderType'));
    expect(fn).toMatch(/enabledProviderTypes\(cfg\)\.includes/);
  });
});
