/**
 * One-off check that migration 18_store_terms_acceptance landed on the live
 * database. Run AFTER `pnpm --filter frontend db:migrate:deploy`:
 *
 *   pnpm --filter frontend exec tsx scripts/verify-store-terms-migration.ts
 *
 * Read-only. Exits non-zero and prints what is missing if anything is wrong.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const problems: string[] = [];

  const cols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Store'
      AND column_name IN ('termsAcceptedAt', 'termsVersion')`;
  const names = new Set(cols.map((c) => c.column_name));
  for (const c of ['termsAcceptedAt', 'termsVersion']) {
    if (!names.has(c)) problems.push(`Store.${c} column missing`);
  }

  const migRow = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM "_prisma_migrations"
    WHERE migration_name = '18_store_terms_acceptance' AND finished_at IS NOT NULL`;
  if (Number(migRow[0]?.n ?? 0) !== 1) {
    problems.push('_prisma_migrations has no finished row for 18_store_terms_acceptance');
  }

  if (problems.length) {
    console.error('❌ store-terms migration verification FAILED:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log(
    '✅ 18_store_terms_acceptance verified — Store.termsAcceptedAt + termsVersion present.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
