/**
 * One-off check that migration 19_legal_document landed on the live
 * database. Run AFTER `pnpm --filter frontend db:migrate:deploy`:
 *
 *   pnpm --filter frontend exec tsx scripts/verify-legal-document-migration.ts
 *
 * Read-only. Exits non-zero and prints what is missing if anything is wrong.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const problems: string[] = [];

  const cols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'LegalDocument'`;
  const names = new Set(cols.map((c) => c.column_name));
  for (const c of ['slug', 'body', 'version', 'updatedAt', 'updatedBy']) {
    if (!names.has(c)) problems.push(`LegalDocument.${c} column missing`);
  }
  if (cols.length === 0) problems.push('LegalDocument table missing entirely');

  const migRow = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM "_prisma_migrations"
    WHERE migration_name = '19_legal_document' AND finished_at IS NOT NULL`;
  if (Number(migRow[0]?.n ?? 0) !== 1) {
    problems.push('_prisma_migrations has no finished row for 19_legal_document');
  }

  if (problems.length) {
    console.error('❌ legal-document migration verification FAILED:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('✅ 19_legal_document verified — LegalDocument table present.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
