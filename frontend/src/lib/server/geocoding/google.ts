/**
 * Google Geocoding API — turns a free-text address into {lat, lng}.
 *
 * Powers MERCHANT mileage-based delivery pricing (fulfillment/config.ts,
 * providers/merchant.ts): a straight-line (haversine) distance between the
 * store's pickup address and the buyer's dropoff address, not a real driving
 * route — no Directions/Distance Matrix call, so no per-quote API cost.
 *
 * Lazy-checked like cloudinary-client.ts: reading `process.env` at
 * handler-call time (never module-top) so `vi.stubEnv` works in tests and an
 * operator can add the key without a redeploy-restart.
 */
import 'server-only';
import { fetchWithTimeout } from '@/lib/server/fulfillment/http';

export class GeocodingNotConfiguredError extends Error {
  constructor() {
    super('Geocoding not configured (GOOGLE_MAPS_API_KEY missing or empty)');
    this.name = 'GeocodingNotConfiguredError';
  }
}

export interface LatLng {
  lat: number;
  lng: number;
}

export function isGeocodingConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

interface GoogleGeocodeResponse {
  status: string;
  results: { geometry: { location: { lat: number; lng: number } } }[];
}

/**
 * Resolves an address to coordinates. Throws `GeocodingNotConfiguredError`
 * when the API key is absent (a platform-config problem the caller should
 * distinguish from "address not found"). Returns `null` for anything else
 * that keeps this from producing a usable result — no match, a malformed
 * response, a timeout, a non-200 — so a mileage-pricing quote degrades to
 * "unserviceable" instead of throwing mid-checkout.
 */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? '';
  if (!apiKey) throw new GeocodingNotConfiguredError();

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as GoogleGeocodeResponse;
    const location = data.status === 'OK' ? data.results[0]?.geometry.location : undefined;
    return location ? { lat: location.lat, lng: location.lng } : null;
  } catch {
    return null;
  }
}
