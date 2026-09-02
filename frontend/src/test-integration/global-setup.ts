// frontend/src/test-integration/global-setup.ts — runs ONCE in the main vitest
// process (not a worker) before any test file loads. `prisma migrate deploy`
// must happen here: doing it from inside a worker via execFileSync deadlocks
// the worker thread on Windows.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { resolveTestDbUrl, toDirectUrl } from './db';

const execFileAsync = promisify(execFile);
const FRONTEND_ROOT = path.resolve(__dirname, '../..');

export default async function globalSetup(): Promise<void> {
  const direct = toDirectUrl(resolveTestDbUrl());
  try {
    const { stdout } = await execFileAsync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: FRONTEND_ROOT,
      timeout: 120_000,
      env: { ...process.env, DATABASE_URL: direct, DIRECT_URL: direct },
      shell: process.platform === 'win32',
    });
    if (process.env.ITEST_VERBOSE) process.stdout.write(stdout);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    throw new Error(
      `[itest] prisma migrate deploy failed:\n${e.stdout ?? ''}\n${e.stderr ?? e.message ?? ''}`,
    );
  }
}
