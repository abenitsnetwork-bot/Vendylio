// UX-01 (Prompt #15) — CSP violation sink for the phase-1 Report-Only policy
// (see next.config.ts `cspReportOnly`). Browsers POST a JSON report here when a
// resource would have been blocked by the enforced policy. We log a compact
// line and return 204 — no body, no auth (the browser sends it unauthenticated),
// no DB. The `pub:csp` IP limiter keeps a misbehaving client from flooding logs.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { createIpLimiter } from '@/lib/server/middleware/rate-limit-by-ip';
import { log } from '@/lib/server/observability/log';

const limiter = createIpLimiter({
  bucket: 'pub:csp',
  windowMs: 60_000,
  max: Number(process.env.CSP_REPORT_RATE_LIMIT_MAX ?? 30),
  code: 'TOO_MANY_REQUESTS',
  message: 'Too many reports.',
});

interface CspReportBody {
  'csp-report'?: Record<string, unknown>;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = await limiter.check(req);
  if (limited) return new NextResponse(null, { status: 204 });

  const body = (await req.json().catch(() => null)) as CspReportBody | null;
  const r = body?.['csp-report'] ?? {};
  log.warn('csp-report', {
    violatedDirective: String(r['violated-directive'] ?? r['effective-directive'] ?? 'unknown'),
    blockedUri: String(r['blocked-uri'] ?? 'unknown'),
    documentUri: String(r['document-uri'] ?? 'unknown'),
  });

  return new NextResponse(null, { status: 204 });
}
