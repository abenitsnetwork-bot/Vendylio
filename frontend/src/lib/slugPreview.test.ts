import { describe, it, expect } from 'vitest';
import { previewSlug } from './slugPreview';

describe('previewSlug', () => {
  it('lowercases, strips diacritics, and hyphenates', () => {
    expect(previewSlug("Adaeze's Shéa Butter Café")).toBe('adaeze-s-shea-butter-cafe');
  });

  it('collapses whitespace/punctuation runs and trims leading/trailing hyphens', () => {
    expect(previewSlug('  Hello   World!! 123  ')).toBe('hello-world-123');
  });

  it('caps length at 64 characters', () => {
    const long = 'a'.repeat(100);
    expect(previewSlug(long)).toHaveLength(64);
  });

  it('returns an empty string for input with no alphanumerics', () => {
    expect(previewSlug('!!!')).toBe('');
  });
});
