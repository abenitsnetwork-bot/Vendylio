// Phase 1a — POST /api/stores/upgrade is now a deprecated 410.
// Pro upgrades go through POST /api/billing/checkout (Stripe subscription).
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

function makePost(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/stores/upgrade', { method: 'POST', headers });
}

describe('POST /api/stores/upgrade (deprecated)', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost('missing'));
    expect(res.status).toBe(403);
  });

  it('410s with USE_BILLING_CHECKOUT for a valid request', async () => {
    const res = await POST(makePost());
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('USE_BILLING_CHECKOUT');
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs', withRequestContext and verifyCsrf", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
    expect(src).toContain('verifyCsrf');
  });
});
