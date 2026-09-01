import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isDomainConfigured,
  isApex,
  routingRecord,
  addDomainToProject,
  removeDomainFromProject,
  getDomainState,
  VercelDomainsUnconfiguredError,
} from './vercel';

const realFetch = global.fetch;

function mockFetch(
  handler: (url: string, init: RequestInit) => { status?: number; body: unknown },
) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status = 200, body } = handler(String(input), init ?? {});
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.stubEnv('VERCEL_API_TOKEN', 'tok_123');
  vi.stubEnv('VERCEL_PROJECT_ID', 'prj_abc');
  vi.stubEnv('VERCEL_TEAM_ID', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  global.fetch = realFetch;
});

describe('config guards', () => {
  it('isDomainConfigured reflects the env', () => {
    expect(isDomainConfigured()).toBe(true);
    vi.stubEnv('VERCEL_API_TOKEN', '');
    expect(isDomainConfigured()).toBe(false);
  });

  it('throws VercelDomainsUnconfiguredError when unset', async () => {
    vi.stubEnv('VERCEL_PROJECT_ID', '');
    await expect(addDomainToProject('x.com')).rejects.toBeInstanceOf(
      VercelDomainsUnconfiguredError,
    );
  });
});

describe('pure helpers', () => {
  it('isApex', () => {
    expect(isApex('brand.com')).toBe(true);
    expect(isApex('shop.brand.com')).toBe(false);
  });
  it('routingRecord: apex → A, subdomain → CNAME', () => {
    expect(routingRecord('brand.com')).toEqual({ type: 'A', name: '@', value: '76.76.21.21' });
    expect(routingRecord('shop.brand.com')).toEqual({
      type: 'CNAME',
      name: 'shop',
      value: 'cname.vercel-dns.com',
    });
  });
});

describe('addDomainToProject', () => {
  it('POSTs to the project domains endpoint with the bearer token', async () => {
    let seenUrl = '';
    let seenAuth = '';
    mockFetch((url, init) => {
      seenUrl = url;
      seenAuth = (init.headers as Record<string, string>).authorization ?? '';
      return { body: { name: 'shop.brand.com', verified: false, verification: [] } };
    });
    const state = await addDomainToProject('shop.brand.com');
    expect(seenUrl).toBe('https://api.vercel.com/v10/projects/prj_abc/domains');
    expect(seenAuth).toBe('Bearer tok_123');
    expect(state.verified).toBe(false);
    expect(state.records[0]).toEqual({
      type: 'CNAME',
      name: 'shop',
      value: 'cname.vercel-dns.com',
    });
  });

  it('appends teamId when set', async () => {
    vi.stubEnv('VERCEL_TEAM_ID', 'team_9');
    let seenUrl = '';
    mockFetch((url) => {
      seenUrl = url;
      return { body: { name: 'shop.brand.com', verified: true } };
    });
    await addDomainToProject('shop.brand.com');
    expect(seenUrl).toContain('?teamId=team_9');
  });

  it('surfaces TXT verification records', async () => {
    mockFetch(() => ({
      body: {
        name: 'brand.com',
        verified: false,
        verification: [{ type: 'TXT', domain: '_vercel.brand.com', value: 'vc-domain-verify=xyz' }],
      },
    }));
    const state = await addDomainToProject('brand.com');
    expect(state.records).toContainEqual({
      type: 'TXT',
      name: '_vercel.brand.com',
      value: 'vc-domain-verify=xyz',
    });
  });
});

describe('getDomainState', () => {
  it('reads verified + misconfigured', async () => {
    mockFetch((url) => {
      if (url.includes('/verify')) return { body: {} };
      if (url.includes('/v6/domains/')) return { body: { misconfigured: true } };
      return { body: { name: 'shop.brand.com', verified: true, verification: [] } };
    });
    const state = await getDomainState('shop.brand.com');
    expect(state).toMatchObject({ domain: 'shop.brand.com', verified: true, misconfigured: true });
  });
});

describe('removeDomainFromProject', () => {
  it('DELETEs the project domain', async () => {
    let seen = '';
    mockFetch((url, init) => {
      seen = `${init.method} ${url}`;
      return { body: {} };
    });
    await removeDomainFromProject('shop.brand.com');
    expect(seen).toBe('DELETE https://api.vercel.com/v9/projects/prj_abc/domains/shop.brand.com');
  });
});
