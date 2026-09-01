// PROMPT #13.5 — guardrails for the real-sandbox harness. Source-scan only:
// this file must never trigger a live provider call in CI.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, 'provider-sandbox-check.ts'), 'utf8');

describe('provider-sandbox-check harness', () => {
  it('drives the existing adapters via the registry, not a parallel client', () => {
    expect(SRC).toMatch(/getDeliveryProvider\(/);
    expect(SRC).not.toMatch(/login\.uber\.com|openapi\.doordash\.com|new DeliveriesClient/);
  });

  it('refuses to run without the explicit opt-in flag', () => {
    expect(SRC).toMatch(/RUN_PROVIDER_SANDBOX_TESTS\s*!==\s*'1'/);
  });

  it('aborts on NODE_ENV=production (spec §38)', () => {
    expect(SRC).toMatch(/NODE_ENV\s*===\s*'production'/);
  });

  it('gates each courier on its *_SANDBOX prod-safety flag', () => {
    expect(SRC).toMatch(/UBER_DIRECT_SANDBOX_TEST_MODE/);
    expect(SRC).toMatch(/DOORDASH_SANDBOX/);
  });

  it('only creates a real delivery behind a second explicit flag', () => {
    expect(SRC).toMatch(/RUN_PROVIDER_SANDBOX_CREATE\s*!==\s*'1'/);
  });

  it('is not auto-run by vitest (scripts glob is *.test.ts only)', () => {
    // This very file is a .test.ts; the harness itself must NOT be.
    expect(SRC).toMatch(/deliberately NOT a vitest file/i);
  });
});
