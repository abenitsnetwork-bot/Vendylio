import { describe, it, expect } from 'vitest';
import { newTrackingToken } from './trackingToken';

describe('newTrackingToken', () => {
  it('produces a 32-char url-safe base64 string', () => {
    const t = newTrackingToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('is unique across many calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newTrackingToken());
    expect(seen.size).toBe(1000);
  });

  it('is not derived from anything guessable (no dashes/plus/slash padding)', () => {
    const t = newTrackingToken();
    expect(t).not.toContain('+');
    expect(t).not.toContain('/');
    expect(t).not.toContain('=');
  });
});
