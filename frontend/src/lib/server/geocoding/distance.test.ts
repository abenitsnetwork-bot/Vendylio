import { describe, it, expect } from 'vitest';
import { haversineMiles } from './distance';

describe('haversineMiles', () => {
  it('is zero for identical points', () => {
    expect(haversineMiles({ lat: 40.7128, lng: -74.006 }, { lat: 40.7128, lng: -74.006 })).toBe(0);
  });

  it('matches the known straight-line distance between two real cities', () => {
    // NYC to Philadelphia — commonly cited straight-line distance ~80 miles.
    const nyc = { lat: 40.7128, lng: -74.006 };
    const philly = { lat: 39.9526, lng: -75.1652 };
    const miles = haversineMiles(nyc, philly);
    expect(miles).toBeGreaterThan(78);
    expect(miles).toBeLessThan(82);
  });

  it('is symmetric', () => {
    const a = { lat: 40.7128, lng: -74.006 };
    const b = { lat: 40.758, lng: -73.9855 };
    expect(haversineMiles(a, b)).toBeCloseTo(haversineMiles(b, a), 10);
  });
});
