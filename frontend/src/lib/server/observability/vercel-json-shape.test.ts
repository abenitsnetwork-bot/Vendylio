// frontend/src/lib/server/observability/vercel-json-shape.test.ts — Phase 5 D-20.
//
// Tripwire: verifies vercel.json declares all 10 cron schedules with valid
// cron-format strings and paths that correspond to actual route.ts files.
// (5 Phase-5 canonical + post-audit email-job-purge + Phase-4-catalogue
// low-stock-sweep + Prompt-#12 fulfillment-tick + Prompt-#15 order-nudge +
// Pro-billing plan-downgrade-sweep.)
//
// Wave 0 status: RED until Wave 1 plan 05-08 ships frontend/vercel.json.
// Once GREEN, this test guards against route-rename / schedule-drift
// regressions where a developer renames a cron route file but forgets
// vercel.json (or vice versa).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import fg from 'fast-glob';

// frontend/src/lib/server/observability/ → frontend/ is 4 levels up.
const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(here, '../../../../');
const VERCEL_JSON = resolve(FRONTEND_ROOT, 'vercel.json');
const APP_API_CRON = resolve(FRONTEND_ROOT, 'src/app/api/cron');

const PATH_RE = /^\/api\/cron\/[a-z][a-z0-9-]*$/;
// Permissive cron-format: 5 fields, each containing only digits, *, /, ,, -, or whitespace
const SCHED_RE = /^[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+\s+[\d*/,-]+$/;

interface VercelConfig {
  crons?: Array<{ path: string; schedule: string }>;
}

describe('vercel.json schema (CRON-07, D-20)', () => {
  it('frontend/vercel.json exists', () => {
    expect(existsSync(VERCEL_JSON)).toBe(true);
  });

  it('declares exactly 10 cron schedules', () => {
    if (!existsSync(VERCEL_JSON)) return; // skip silently when RED-by-design
    const cfg = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as VercelConfig;
    expect(cfg.crons).toBeDefined();
    expect(cfg.crons!.length).toBe(10);
  });

  it('every cron path matches /^\\/api\\/cron\\/[a-z-]+$/ and schedule is valid 5-field cron', () => {
    if (!existsSync(VERCEL_JSON)) return;
    const cfg = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as VercelConfig;
    for (const c of cfg.crons ?? []) {
      expect(c.path).toMatch(PATH_RE);
      expect(c.schedule).toMatch(SCHED_RE);
    }
  });

  it('every cron path corresponds to an existing app/api/cron/<name>/route.ts file', async () => {
    if (!existsSync(VERCEL_JSON)) return;
    const cfg = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as VercelConfig;
    const routeFiles = await fg('*/route.ts', { cwd: APP_API_CRON, onlyFiles: true });
    const routeNames = new Set(routeFiles.map((f) => f.split('/')[0]));
    for (const c of cfg.crons ?? []) {
      const name = c.path.replace('/api/cron/', '');
      expect(
        routeNames.has(name),
        `vercel.json declares /api/cron/${name} but no route.ts found`,
      ).toBe(true);
    }
  });

  it('every cron route.ts exports GET (Vercel Cron invokes cron paths with GET)', async () => {
    const routeFiles = await fg('*/route.ts', { cwd: APP_API_CRON, onlyFiles: true });
    expect(routeFiles.length).toBeGreaterThan(0);
    for (const rel of routeFiles) {
      const src = readFileSync(resolve(APP_API_CRON, rel), 'utf8');
      expect(
        /export\s+(async\s+function|const)\s+GET\b/.test(src),
        `${rel} has no GET export — Vercel Cron GET requests would 405`,
      ).toBe(true);
    }
  });

  it('declares schedules for the 10 canonical crons (Phase 5 + post-audit + Phase 4 catalogue + Prompt #12 fulfillment + Prompt #15 order-nudge + Pro-billing plan-downgrade-sweep)', () => {
    if (!existsSync(VERCEL_JSON)) return;
    const cfg = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as VercelConfig;
    const paths = (cfg.crons ?? []).map((c) => c.path).sort();
    expect(paths).toEqual([
      '/api/cron/email-job-purge',
      '/api/cron/email-queue-drain',
      '/api/cron/fulfillment-tick',
      '/api/cron/low-stock-sweep',
      '/api/cron/order-expiration',
      '/api/cron/order-nudge',
      '/api/cron/outbox-drain',
      '/api/cron/plan-downgrade-sweep',
      '/api/cron/verification-cleanup',
      '/api/cron/webhook-log-purge',
    ]);
  });
});
