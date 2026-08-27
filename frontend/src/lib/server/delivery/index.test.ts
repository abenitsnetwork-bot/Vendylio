import { describe, it, expect } from 'vitest';
import { getDeliveryProviderFor } from './index';

describe('getDeliveryProviderFor', () => {
  it('resolves self_manual', () => {
    expect(getDeliveryProviderFor('self_manual').name).toBe('self_manual');
  });

  it('resolves uber_direct', () => {
    expect(getDeliveryProviderFor('uber_direct').name).toBe('uber_direct');
  });

  it('defaults to self_manual for an unknown provider value (fail-safe, never fail-throw)', () => {
    expect(getDeliveryProviderFor('something_unknown').name).toBe('self_manual');
  });
});
