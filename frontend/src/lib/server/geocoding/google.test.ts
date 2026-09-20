import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { geocodeAddress, isGeocodingConfigured, GeocodingNotConfiguredError } from './google';

function mockFetchOnce(ok: boolean, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok, json: async () => body }));
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('isGeocodingConfigured', () => {
  it('reflects whether the API key env var is set', () => {
    expect(isGeocodingConfigured()).toBe(true);
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    expect(isGeocodingConfigured()).toBe(false);
  });
});

describe('geocodeAddress', () => {
  it('throws GeocodingNotConfiguredError when the API key is missing', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    await expect(geocodeAddress('1 Main St')).rejects.toBeInstanceOf(GeocodingNotConfiguredError);
  });

  it('returns coordinates on a successful lookup', async () => {
    mockFetchOnce(true, {
      status: 'OK',
      results: [{ geometry: { location: { lat: 40.7128, lng: -74.006 } } }],
    });
    await expect(geocodeAddress('1 Main St')).resolves.toEqual({ lat: 40.7128, lng: -74.006 });
  });

  it('returns null when Google reports ZERO_RESULTS', async () => {
    mockFetchOnce(true, { status: 'ZERO_RESULTS', results: [] });
    await expect(geocodeAddress('nonsense address')).resolves.toBeNull();
  });

  it('returns null on a non-200 response', async () => {
    mockFetchOnce(false, {});
    await expect(geocodeAddress('1 Main St')).resolves.toBeNull();
  });

  it('returns null instead of throwing on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network down')));
    await expect(geocodeAddress('1 Main St')).resolves.toBeNull();
  });
});
