import { describe, it, expect } from 'vitest';
import { cashAppPaymentUrl } from './CashAppQRCode';

describe('cashAppPaymentUrl', () => {
  it('builds the documented Cash App deep-link format with a 2-decimal dollar amount', () => {
    expect(cashAppPaymentUrl('AdaezeShop', 1800)).toBe('https://cash.app/$AdaezeShop/18.00');
  });

  it('rounds fractional cents correctly', () => {
    expect(cashAppPaymentUrl('AdaezeShop', 1)).toBe('https://cash.app/$AdaezeShop/0.01');
  });
});
