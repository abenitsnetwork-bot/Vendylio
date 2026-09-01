import { describe, it, expect } from 'vitest';
import { cloudinaryUrl, cloudinarySrcSet } from './cloudinaryImage';

const CLD = 'https://res.cloudinary.com/demo/image/upload/v123/products/shea.jpg';

describe('cloudinaryImage (PERF-01)', () => {
  it('injects f_auto,q_auto,w_,c_limit into a Cloudinary upload URL', () => {
    expect(cloudinaryUrl(CLD, { width: 400 })).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_400,c_limit/v123/products/shea.jpg',
    );
  });

  it('uses c_fill + h_ when crop:fill and a height are given', () => {
    expect(cloudinaryUrl(CLD, { width: 400, height: 400, crop: 'fill' })).toContain(
      'w_400,h_400,c_fill/',
    );
  });

  it('leaves a non-Cloudinary URL untouched', () => {
    expect(cloudinaryUrl('https://example.com/a.png', { width: 400 })).toBe(
      'https://example.com/a.png',
    );
    expect(cloudinaryUrl('data:image/png;base64,AAAA', { width: 400 })).toBe(
      'data:image/png;base64,AAAA',
    );
  });

  it('srcSet emits 1x + 2x for Cloudinary, undefined otherwise', () => {
    const s = cloudinarySrcSet(CLD, 200);
    expect(s).toContain('w_200,c_limit');
    expect(s).toContain('w_400,c_limit');
    expect(s).toMatch(/ 1x, .* 2x$/);
    expect(cloudinarySrcSet('https://example.com/a.png', 200)).toBeUndefined();
  });
});
