// frontend/src/test-integration/db.ts — real-database plumbing for the C1 harness.
//
// Resolves the test database URL, runs migrations once, and truncates every
// table between tests. NEVER touches the dev/prod database — resolveTestDbUrl()
// refuses a URL that looks like the one in .env / .env.local.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const FRONTEND_ROOT = path.resolve(__dirname, '../..');

/** Read a KEY=value out of a dotenv file without loading it into process.env. */
function peekEnvFile(file: string, key: string): string | null {
  const full = path.join(FRONTEND_ROOT, file);
  if (!existsSync(full)) return null;
  for (const line of readFileSync(full, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] === key) return m[2]!.replace(/^["']|["']$/g, '').trim();
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The test database connection string. Must be explicitly set and must NOT be
 * the dev/prod database (same host as .env DATABASE_URL / DIRECT_URL) — the
 * harness TRUNCATEs every table between tests.
 */
export function resolveTestDbUrl(): string {
  const url = (
    process.env.TEST_DATABASE_URL ??
    peekEnvFile('.env.local', 'TEST_DATABASE_URL') ??
    peekEnvFile('.env', 'TEST_DATABASE_URL') ??
    ''
  ).trim();
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a throwaway Postgres (a Neon branch, ' +
        'or a local container) — NOT your dev database. See src/test-integration/README.md.',
    );
  }
  const testHost = hostOf(url);
  for (const file of ['.env', '.env.local']) {
    for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
      const live = peekEnvFile(file, key);
      if (live && hostOf(live) && hostOf(live) === testHost) {
        throw new Error(
          `TEST_DATABASE_URL points at the same host as ${file}:${key} (${testHost}). ` +
            'The integration harness TRUNCATEs every table — refusing to run against dev/prod.',
        );
      }
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the integration harness with NODE_ENV=production.');
  }
  return url;
}

let migrated = false;

/** `prisma migrate deploy` against the test database — once per process. */
export function ensureMigrated(testDbUrl: string): void {
  if (migrated) return;
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: FRONTEND_ROOT,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testDbUrl, DIRECT_URL: testDbUrl },
    shell: process.platform === 'win32',
  });
  migrated = true;
}

/**
 * Wipe every table in the `public` schema (except Prisma's own migration
 * bookkeeping) and reset identity sequences. Discovered dynamically so a new
 * model never silently escapes the reset.
 */
export async function truncateAll(prisma: {
  $queryRawUnsafe: (sql: string) => Promise<Array<{ tablename: string }>>;
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
}): Promise<void> {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma\\_%'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
