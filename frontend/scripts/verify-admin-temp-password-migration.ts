/**
 * One-off check that migration 17_admin_temp_password landed on the live
 * database. Run AFTER `pnpm --filter frontend db:migrate:deploy`:
 *
 *   pnpm --filter frontend exec tsx scripts/verify-admin-temp-password-migration.ts
 *
 * Read-only. Exits non-zero and prints what is missing if anything is wrong.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const problems: string[] = [];

  const cols = await prisma.$queryRaw<{ column_name: string; column_default: string | null }[]>`
    SELECT column_name, column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'mustChangePassword'`;
  if (cols.length !== 1) {
    problems.push('User.mustChangePassword column missing');
  } else if (!/false/i.test(cols[0]?.column_default ?? '')) {
    problems.push(`User.mustChangePassword default is not false (${cols[0]?.column_default})`);
  }

  const migRow = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM "_prisma_migrations"
    WHERE migration_name = '17_admin_temp_password' AND finished_at IS NOT NULL`;
  if (Number(migRow[0]?.n ?? 0) !== 1) {
    problems.push('_prisma_migrations has no finished row for 17_admin_temp_password');
  }

  if (problems.length) {
    console.error('❌ admin-temp-password migration verification FAILED:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log(
    '✅ 17_admin_temp_password verified — User.mustChangePassword present, default false.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
