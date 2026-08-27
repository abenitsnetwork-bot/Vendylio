import { describe, it, expect } from 'vitest';
import { isColorAxis, colorNameToHex } from './colorSwatch';

describe('isColorAxis', () => {
  it('recognizes "Color" and "Colour" case-insensitively', () => {
    expect(isColorAxis('Color')).toBe(true);
    expect(isColorAxis('colour')).toBe(true);
    expect(isColorAxis('  COLOR  ')).toBe(true);
  });

  it('rejects other axis names', () => {
    expect(isColorAxis('Size')).toBe(false);
    expect(isColorAxis('Weight')).toBe(false);
  });
});

describe('colorNameToHex', () => {
  it('resolves a known color name case/whitespace-insensitively', () => {
    expect(colorNameToHex('Red')).toBe('#dc2626');
    expect(colorNameToHex('  black ')).toBe('#111111');
  });

  it('returns null for an unrecognized value (never fabricates a color)', () => {
    expect(colorNameToHex('Sunset Orange')).toBeNull();
    expect(colorNameToHex('Large')).toBeNull();
  });
});
