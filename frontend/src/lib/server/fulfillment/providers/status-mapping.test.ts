import { describe, it, expect } from 'vitest';
import { normalizeUberStatus } from './uber-direct';
import { normalizeDoorDashStatus } from './doordash';
import type { ProviderStateOrUnknown } from '../types';

describe('normalizeUberStatus', () => {
  const cases: [string, ProviderStateOrUnknown][] = [
    ['pending', 'REQUESTED'],
    ['pickup', 'CONFIRMED'],
    ['pickup_complete', 'PICKED_UP'],
    ['dropoff', 'OUT_FOR_DELIVERY'],
    ['delivered', 'DELIVERED'],
    ['canceled', 'CANCELLED'],
    ['returned', 'FAILED'],
    ['DELIVERED', 'DELIVERED'],
    ['some_new_status', 'UNKNOWN'],
  ];
  it.each(cases)('%s → %s', (raw, expected) => {
    expect(normalizeUberStatus(raw)).toBe(expected);
  });
});

describe('normalizeDoorDashStatus', () => {
  const cases: [string, ProviderStateOrUnknown][] = [
    ['created', 'REQUESTED'],
    ['quote_accepted', 'REQUESTED'],
    ['dasher_confirmed', 'CONFIRMED'],
    ['arrived_at_pickup', 'CONFIRMED'],
    ['picked_up', 'PICKED_UP'],
    ['en_route_to_dropoff', 'OUT_FOR_DELIVERY'],
    ['arrived_at_dropoff', 'OUT_FOR_DELIVERY'],
    ['delivered', 'DELIVERED'],
    ['cancelled', 'CANCELLED'],
    ['delivery_attempt_failed', 'FAILED'],
    ['returned', 'FAILED'],
    ['brand_new_status', 'UNKNOWN'],
  ];
  it.each(cases)('%s → %s', (raw, expected) => {
    expect(normalizeDoorDashStatus(raw)).toBe(expected);
  });
});
