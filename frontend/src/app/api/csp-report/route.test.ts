import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware/rate-limit-by-ip', () => ({
  createIpLimiter: () => ({ check: async () => null }),
}));

import { POST } from './route';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/csp-report', () => {
  it('returns 204 for a well-formed report', async () => {
    const res = await POST(
      makeReq({
        'csp-report': {
          'violated-directive': 'connect-src',
          'blocked-uri': 'https://evil.example',
          'document-uri': 'https://vendylio.example/s/acme',
        },
      }),
    );
    expect(res.status).toBe(204);
  });

  it('returns 204 even for a malformed body (never throws)', async () => {
    const res = await POST(makeReq('not-an-object'));
    expect(res.status).toBe(204);
  });
});
