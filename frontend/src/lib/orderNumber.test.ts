import { describe, it, expect } from 'vitest';
import { formatOrderNumber, parseOrderNumberQuery } from './orderNumber';

describe('formatOrderNumber', () => {
  it('offsets by 10000 and prefixes with VND-', () => {
    expect(formatOrderNumber(1)).toBe('VND-10001');
    expect(formatOrderNumber(42)).toBe('VND-10042');
    expect(formatOrderNumber(0)).toBe('VND-10000');
    expect(formatOrderNumber(999)).toBe('VND-10999');
  });
});

describe('parseOrderNumberQuery', () => {
  it('parses a full display number back to the raw column value', () => {
    expect(parseOrderNumberQuery('VND-10042')).toBe(42);
    expect(parseOrderNumberQuery('vnd-10042')).toBe(42);
    expect(parseOrderNumberQuery('vnd 10042')).toBe(42);
    expect(parseOrderNumberQuery('#10042')).toBe(42);
    expect(parseOrderNumberQuery('10042')).toBe(42);
  });

  it('treats a small bare value as the raw column value', () => {
    expect(parseOrderNumberQuery('42')).toBe(42);
    expect(parseOrderNumberQuery('  7 ')).toBe(7);
  });

  it('round-trips with formatOrderNumber', () => {
    for (const n of [0, 1, 42, 500, 9999, 123456]) {
      expect(parseOrderNumberQuery(formatOrderNumber(n))).toBe(n);
    }
  });

  it('returns null for input with no digits', () => {
    expect(parseOrderNumberQuery('')).toBeNull();
    expect(parseOrderNumberQuery('   ')).toBeNull();
    expect(parseOrderNumberQuery('John Smith')).toBeNull();
    expect(parseOrderNumberQuery('VND-')).toBeNull();
  });
});
