// Source: planner-derived; covers OPS-05.
// Asserts next.config.ts is clean of the deprecated experimental.instrumentationHook.
// Per RESEARCH.md line 12: VERIFIED ABSENT — this test locks the absence so a future
// contributor cannot silently re-introduce the flag.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// From frontend/src/lib/server/observability/ → frontend/next.config.ts is 4 levels up.
const NEXT_CONFIG = resolve(__dirname, '../../../../next.config.ts');
// frontend/src/proxy.ts is 3 levels up.
const PROXY = resolve(__dirname, '../../../proxy.ts');

describe('next.config.ts is clean of deprecated config (OPS-05)', () => {
  const src = readFileSync(NEXT_CONFIG, 'utf8');

  it('does not contain the deprecated instrumentationHook flag', () => {
    // experimental.instrumentationHook is removed in Next.js 15+; auto-discovery
    // of instrumentation.ts replaces it. Re-introducing it triggers a deprecation
    // warning at build time.
    expect(src).not.toContain('instrumentationHook');
  });

  it('does not declare an experimental block targeting instrumentation', () => {
    // Defensive: catches `experimental: { instrumentationHook: true }` even if
    // a refactor splits the assignment across lines.
    expect(src).not.toMatch(/experimental[^}]*instrumentation/i);
  });

  // UX-01 (Prompt #15) — CSP phase 1 was Report-Only in next.config.ts.
  // Phase 2 (this branch) promoted it to the enforcing `Content-Security-Policy`
  // header with a per-request nonce, which lives in src/proxy.ts (a nonce can't
  // ride a static CDN header). next.config.ts KEEPS emitting the Report-Only
  // header during the transition — the two run in parallel until the enforcing
  // policy has been observed clean, then Report-Only is removed in a follow-up.
  it('still ships the Report-Only header from next.config.ts (transition)', () => {
    expect(src).toContain('Content-Security-Policy-Report-Only');
    expect(src).toMatch(/report-uri \/api\/csp-report/);
    // The enforcing header is NOT in next.config.ts — it must carry a nonce, so
    // it is built per-request in proxy.ts instead.
    expect(src).not.toMatch(/key:\s*['"]Content-Security-Policy['"]/);
  });

  it('proxy.ts builds the enforcing CSP with a per-request nonce', () => {
    const proxySrc = readFileSync(PROXY, 'utf8');
    // Enforcing header (not Report-Only) set on the response.
    expect(proxySrc).toMatch(/set\(\s*['"]Content-Security-Policy['"]/);
    // Nonce-based, strict-dynamic script-src — 'unsafe-inline' is gone.
    expect(proxySrc).toContain("'strict-dynamic'");
    expect(proxySrc).toMatch(/nonce-\$\{nonce\}/);
    expect(proxySrc).toMatch(/script-src \$\{scriptSrc\}/);
    // The nonce is staged on the request headers for Next's auto-injection.
    expect(proxySrc).toMatch(/set\(\s*['"]x-nonce['"]/);
    // report-uri kept on the enforcing policy too.
    expect(proxySrc).toMatch(/report-uri \/api\/csp-report/);
  });
});
