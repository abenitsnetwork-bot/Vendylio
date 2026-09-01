// Phase 4b — thin client for the Vercel Domains API, used to attach a
// merchant's custom storefront domain to this Vercel project.
//
// Inert without VERCEL_API_TOKEN + VERCEL_PROJECT_ID: `isDomainConfigured()`
// is false and every call throws `VercelDomainsUnconfiguredError` (the route
// turns that into 503 DOMAIN_NOT_CONFIGURED — same posture as Stripe /
// Cloudinary). VERCEL_TEAM_ID is optional (only for team-scoped projects).
import 'server-only';
import { fetchWithTimeout } from '@/lib/server/fulfillment/http';

const API_BASE = 'https://api.vercel.com';

export class VercelDomainsUnconfiguredError extends Error {
  constructor() {
    super('Vercel Domains not configured (VERCEL_API_TOKEN / VERCEL_PROJECT_ID missing)');
    this.name = 'VercelDomainsUnconfiguredError';
  }
}

export class VercelApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'VercelApiError';
    this.status = status;
    this.code = code;
  }
}

export function isDomainConfigured(): boolean {
  return Boolean(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID);
}

function cfg(): { token: string; projectId: string; teamId: string | null } {
  const token = process.env.VERCEL_API_TOKEN ?? '';
  const projectId = process.env.VERCEL_PROJECT_ID ?? '';
  if (!token || !projectId) throw new VercelDomainsUnconfiguredError();
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID || null };
}

function url(path: string, teamId: string | null): string {
  return teamId
    ? `${API_BASE}${path}${path.includes('?') ? '&' : '?'}teamId=${teamId}`
    : `${API_BASE}${path}`;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { token, teamId } = cfg();
  const res = await fetchWithTimeout(url(path, teamId), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const err = (json.error ?? {}) as { code?: string; message?: string };
    throw new VercelApiError(
      res.status,
      err.code ?? 'vercel_error',
      err.message ?? `Vercel API ${res.status}`,
    );
  }
  return json as T;
}

export interface DnsRecord {
  type: 'A' | 'CNAME' | 'TXT';
  name: string; // "@" for apex, or the subdomain label
  value: string;
}

export interface DomainState {
  domain: string;
  verified: boolean;
  /** Vercel says the DNS points somewhere else / is not set up. */
  misconfigured: boolean;
  /** DNS records the merchant must create. */
  records: DnsRecord[];
}

interface VercelProjectDomain {
  name: string;
  verified: boolean;
  verification?: Array<{ type: string; domain: string; value: string }>;
}

interface VercelDomainConfig {
  misconfigured?: boolean;
}

/** Is `host` an apex domain (brand.com) rather than a subdomain (shop.brand.com)? */
export function isApex(host: string): boolean {
  return host.split('.').filter(Boolean).length <= 2;
}

/**
 * The routing record a merchant adds at their DNS provider so the domain
 * resolves to Vercel. Apex → A record; subdomain → CNAME. (Values are
 * Vercel's documented, stable targets.)
 */
export function routingRecord(host: string): DnsRecord {
  if (isApex(host)) {
    return { type: 'A', name: '@', value: '76.76.21.21' };
  }
  const label = host.split('.').slice(0, -2).join('.') || host.split('.')[0]!;
  return { type: 'CNAME', name: label, value: 'cname.vercel-dns.com' };
}

function verificationRecords(d: VercelProjectDomain): DnsRecord[] {
  return (d.verification ?? [])
    .filter((v) => v.type.toUpperCase() === 'TXT')
    .map((v) => ({ type: 'TXT' as const, name: v.domain, value: v.value }));
}

export async function addDomainToProject(domain: string): Promise<DomainState> {
  const { projectId } = cfg();
  const created = await call<VercelProjectDomain>('POST', `/v10/projects/${projectId}/domains`, {
    name: domain,
  });
  return {
    domain,
    verified: Boolean(created.verified),
    misconfigured: !created.verified,
    records: [routingRecord(domain), ...verificationRecords(created)],
  };
}

export async function removeDomainFromProject(domain: string): Promise<void> {
  const { projectId } = cfg();
  await call('DELETE', `/v9/projects/${projectId}/domains/${domain}`);
}

/**
 * Current state of `domain` on the project: triggers a verification attempt,
 * then reads back `verified` + whether the DNS is misconfigured.
 */
export async function getDomainState(domain: string): Promise<DomainState> {
  const { projectId } = cfg();

  // Best-effort verify trigger — ignore its failure, we read state next.
  await call('POST', `/v9/projects/${projectId}/domains/${domain}/verify`).catch(() => {});

  const [projDomain, config] = await Promise.all([
    call<VercelProjectDomain>('GET', `/v9/projects/${projectId}/domains/${domain}`),
    call<VercelDomainConfig>('GET', `/v6/domains/${domain}/config`).catch(
      () => ({ misconfigured: false }) as VercelDomainConfig,
    ),
  ]);

  return {
    domain,
    verified: Boolean(projDomain.verified),
    misconfigured: Boolean(config.misconfigured),
    records: [routingRecord(domain), ...verificationRecords(projDomain)],
  };
}
