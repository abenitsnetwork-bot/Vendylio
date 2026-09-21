import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSalesTaxNexus, normalizeUsState } from './salesTaxNexus';

const from = new Date('2026-01-01T00:00:00Z');
const to = new Date('2027-01-01T00:00:00Z');

beforeEach(() => {
  prismaMock.order.findMany.mockResolvedValue([]);
  prismaMock.store.findMany.mockResolvedValue([]);
});

describe('normalizeUsState', () => {
  it('passes through a valid 2-letter code, case-insensitive', () => {
    expect(normalizeUsState('ca')).toBe('CA');
    expect(normalizeUsState('NY')).toBe('NY');
  });

  it('resolves a full state name, case-insensitive', () => {
    expect(normalizeUsState('california')).toBe('CA');
    expect(normalizeUsState('New York')).toBe('NY');
  });

  it('returns null for empty, missing or unrecognized input', () => {
    expect(normalizeUsState(null)).toBeNull();
    expect(normalizeUsState(undefined)).toBeNull();
    expect(normalizeUsState('   ')).toBeNull();
    expect(normalizeUsState('Not A State')).toBeNull();
  });
});

describe('buildSalesTaxNexus', () => {
  it('sources a DELIVERY order to the buyer address state', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        storeId: 's1',
        amount: 5000,
        status: 'PAID',
        fulfillmentMethod: 'DELIVERY',
        deliveryAddress: { street: '1 Main St', city: 'LA', state: 'CA', zip: '90001' },
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', state: 'TX' }] as never);

    const result = await buildSalesTaxNexus({ from, to });
    const row = result.rows.find((r) => r.state === 'California (CA)');
    expect(row).toMatchObject({ gross: 5000, transactions: 1 });
    expect(result.rows.find((r) => String(r.state).startsWith('Texas'))).toBeUndefined();
  });

  it('falls back to the store state for a PICKUP order', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        storeId: 's1',
        amount: 3000,
        status: 'PAID',
        fulfillmentMethod: 'PICKUP',
        deliveryAddress: null,
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', state: 'Texas' }] as never);

    const result = await buildSalesTaxNexus({ from, to });
    const row = result.rows.find((r) => String(r.state).startsWith('Texas'));
    expect(row).toMatchObject({ gross: 3000, transactions: 1 });
  });

  it('falls back to the store state when a DELIVERY order has no usable address state', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        storeId: 's1',
        amount: 1200,
        status: 'PAID',
        fulfillmentMethod: 'DELIVERY',
        deliveryAddress: { street: '1 Main St', city: 'Metropolis', state: '', zip: '' },
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', state: 'NY' }] as never);

    const result = await buildSalesTaxNexus({ from, to });
    expect(result.rows.find((r) => r.state === 'New York (NY)')).toMatchObject({ gross: 1200 });
  });

  it('buckets to Unknown when neither the address nor the store resolve to a US state', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        storeId: 's1',
        amount: 900,
        status: 'PAID',
        fulfillmentMethod: 'PICKUP',
        deliveryAddress: null,
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', state: null }] as never);

    const result = await buildSalesTaxNexus({ from, to });
    expect(result.rows.find((r) => r.state === 'Unknown')).toMatchObject({ gross: 900 });
  });

  it('counts a REFUNDED order in refunds only, not gross or transactions', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        storeId: 's1',
        amount: 4000,
        status: 'REFUNDED',
        fulfillmentMethod: 'PICKUP',
        deliveryAddress: null,
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', state: 'CA' }] as never);

    const result = await buildSalesTaxNexus({ from, to });
    const row = result.rows.find((r) => r.state === 'California (CA)');
    expect(row).toMatchObject({
      gross: 0,
      refunds: 4000,
      netGmv: -4000,
      transactions: 0,
      flag: '',
    });
  });

  it('flags a state that crosses the $100k gross threshold', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        storeId: 's1',
        amount: 10_000_001,
        status: 'PAID',
        fulfillmentMethod: 'PICKUP',
        deliveryAddress: null,
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', state: 'CA' }] as never);

    const result = await buildSalesTaxNexus({ from, to });
    expect(result.rows.find((r) => r.state === 'California (CA)')?.flag).toBe('Nexus review');
  });

  it('flags a state that crosses the 200-transaction threshold even at low dollar volume', async () => {
    const orders = Array.from({ length: 200 }, () => ({
      storeId: 's1',
      amount: 100,
      status: 'PAID',
      fulfillmentMethod: 'PICKUP',
      deliveryAddress: null,
    }));
    prismaMock.order.findMany.mockResolvedValue(orders as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', state: 'CA' }] as never);

    const result = await buildSalesTaxNexus({ from, to });
    const row = result.rows.find((r) => r.state === 'California (CA)');
    expect(row?.transactions).toBe(200);
    expect(row?.flag).toBe('Nexus review');
  });

  it('does not flag a state under both thresholds', async () => {
    prismaMock.order.findMany.mockResolvedValue([
      {
        storeId: 's1',
        amount: 5000,
        status: 'PAID',
        fulfillmentMethod: 'PICKUP',
        deliveryAddress: null,
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValue([{ id: 's1', state: 'CA' }] as never);

    const result = await buildSalesTaxNexus({ from, to });
    expect(result.rows.find((r) => r.state === 'California (CA)')?.flag).toBe('');
  });
});
