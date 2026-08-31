import { describe, it, expect } from 'vitest';
import { canTransition, isTerminal, mapToOrderStatus, rank } from './stateMachine';
import type { NormalizedState } from './types';

describe('rank / isTerminal', () => {
  it('is monotonic along the happy path', () => {
    const path: NormalizedState[] = [
      'PENDING',
      'QUOTED',
      'REQUESTED',
      'CONFIRMED',
      'PICKED_UP',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ];
    for (let i = 1; i < path.length; i++) {
      expect(rank(path[i]!)).toBeGreaterThan(rank(path[i - 1]!));
    }
  });

  it('marks the three terminal states', () => {
    expect(isTerminal('DELIVERED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(true);
    expect(isTerminal('OUT_FOR_DELIVERY')).toBe(false);
  });
});

describe('canTransition — PROVIDER / CRON (forward-only)', () => {
  it('allows a forward step', () => {
    expect(canTransition('REQUESTED', 'PICKED_UP', 'PROVIDER')).toBe(true);
    expect(canTransition('CONFIRMED', 'OUT_FOR_DELIVERY', 'CRON')).toBe(true);
  });

  it('blocks an out-of-order / replayed lower-rank event', () => {
    expect(canTransition('OUT_FOR_DELIVERY', 'CONFIRMED', 'PROVIDER')).toBe(false);
    expect(canTransition('PICKED_UP', 'REQUESTED', 'CRON')).toBe(false);
  });

  it('allows a terminal correction from any live state', () => {
    expect(canTransition('REQUESTED', 'FAILED', 'PROVIDER')).toBe(true);
    expect(canTransition('PICKED_UP', 'CANCELLED', 'PROVIDER')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'CRON')).toBe(true);
  });

  it('never moves out of a terminal state', () => {
    expect(canTransition('DELIVERED', 'OUT_FOR_DELIVERY', 'PROVIDER')).toBe(false);
    expect(canTransition('FAILED', 'DELIVERED', 'PROVIDER')).toBe(false);
    expect(canTransition('CANCELLED', 'PENDING', 'PROVIDER')).toBe(false);
  });

  it('is a no-op for an identical state', () => {
    expect(canTransition('PICKED_UP', 'PICKED_UP', 'PROVIDER')).toBe(false);
  });
});

describe('canTransition — MERCHANT', () => {
  it('walks the manual happy path one step at a time', () => {
    expect(canTransition('PENDING', 'REQUESTED', 'MERCHANT')).toBe(true);
    expect(canTransition('REQUESTED', 'OUT_FOR_DELIVERY', 'MERCHANT')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'MERCHANT')).toBe(true);
  });

  it('does not let a merchant skip steps', () => {
    expect(canTransition('PENDING', 'OUT_FOR_DELIVERY', 'MERCHANT')).toBe(false);
    expect(canTransition('REQUESTED', 'DELIVERED', 'MERCHANT')).toBe(false);
  });

  it('can cancel from any non-terminal state', () => {
    expect(canTransition('REQUESTED', 'CANCELLED', 'MERCHANT')).toBe(true);
    expect(canTransition('OUT_FOR_DELIVERY', 'CANCELLED', 'MERCHANT')).toBe(true);
    expect(canTransition('DELIVERED', 'CANCELLED', 'MERCHANT')).toBe(false);
  });
});

describe('canTransition — SYSTEM', () => {
  it('allows the FAILED → PENDING retry only', () => {
    expect(canTransition('FAILED', 'PENDING', 'SYSTEM')).toBe(true);
    expect(canTransition('CANCELLED', 'PENDING', 'SYSTEM')).toBe(false);
    expect(canTransition('REQUESTED', 'PENDING', 'SYSTEM')).toBe(false);
  });
});

describe('mapToOrderStatus', () => {
  it('leaves the order alone while the courier is being arranged', () => {
    expect(mapToOrderStatus('PENDING').target).toBeNull();
    expect(mapToOrderStatus('QUOTED').target).toBeNull();
    expect(mapToOrderStatus('REQUESTED').target).toBeNull();
    expect(mapToOrderStatus('CONFIRMED').target).toBeNull();
  });

  it('moves the order to OUT_FOR_DELIVERY once picked up', () => {
    expect(mapToOrderStatus('PICKED_UP').target).toBe('OUT_FOR_DELIVERY');
    expect(mapToOrderStatus('OUT_FOR_DELIVERY').target).toBe('OUT_FOR_DELIVERY');
  });

  it('delivers the order', () => {
    expect(mapToOrderStatus('DELIVERED').target).toBe('DELIVERED');
  });

  it('reverts to READY on failure only when currently out for delivery', () => {
    expect(mapToOrderStatus('FAILED')).toEqual({
      target: 'READY',
      onlyIfCurrentlyOutForDelivery: true,
    });
    expect(mapToOrderStatus('CANCELLED')).toEqual({
      target: 'READY',
      onlyIfCurrentlyOutForDelivery: true,
    });
  });
});
