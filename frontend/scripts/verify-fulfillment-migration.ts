/**
 * One-off check that migration 15_phase_fulfillment_engine landed on the live
 * database exactly as intended. Run AFTER `pnpm --filter frontend db:migrate:deploy`:
 *
 *   pnpm --filter frontend exec tsx scripts/verify-fulfillment-migration.ts
 *
 * Read-only. Exits non-zero and prints what is missing if anything is wrong.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EXPECT_DELIVERY_COLS = [
  'state',
  'providerType',
  'externalDeliveryId',
  'quoteId',
  'providerQuoteId',
  'quotedFeeCents',
  'feeCents',
  'providerCostCents',
  'currency',
  'quoteExpiresAt',
  'estimatedPickupAt',
  'estimatedDropoffAt',
  'dispatchedAt',
  'pickedUpAt',
  'cancelledAt',
  'cancelReason',
  'lastProviderStatus',
  'attemptCount',
  'failureReason',
];
const EXPECT_ORDER_COLS = [
  'deliveryProviderType',
  'deliveryQuoteId',
  'providerQuoteId',
  'deliveryQuoteExpiresAt',
  'providerCostCents',
];
const EXPECT_STORE_COLS = ['fulfillmentConfig', 'country'];

async function columns(table: string): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  return new Set(rows.map((r) => r.column_name));
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}`;
  return Number(rows[0]?.n ?? 0) > 0;
}

async function indexExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ${name}`;
  return Number(rows[0]?.n ?? 0) > 0;
}

async function main() {
  const problems: string[] = [];

  const del = await columns('Delivery');
  for (const c of EXPECT_DELIVERY_COLS) if (!del.has(c)) problems.push(`Delivery.${c} missing`);

  const ord = await columns('Order');
  for (const c of EXPECT_ORDER_COLS) if (!ord.has(c)) problems.push(`Order.${c} missing`);

  const store = await columns('Store');
  for (const c of EXPECT_STORE_COLS) if (!store.has(c)) problems.push(`Store.${c} missing`);

  for (const t of ['DeliveryEvent', 'Quote']) {
    if (!(await tableExists(t))) problems.push(`table ${t} missing`);
  }

  for (const i of [
    'Delivery_state_idx',
    'Delivery_externalDeliveryId_key',
    'DeliveryEvent_deliveryId_providerEventId_key',
    'DeliveryEvent_deliveryId_createdAt_idx',
    'Quote_batchId_idx',
    'Quote_expiresAt_idx',
  ]) {
    if (!(await indexExists(i))) problems.push(`index ${i} missing`);
  }

  // Spot-check the Store backfill produced a populated config.
  const sample = await prisma.$queryRaw<{ bad: bigint }[]>`
    SELECT count(*)::bigint AS bad FROM "Store"
    WHERE "fulfillmentConfig" = '{}'::jsonb`;
  if (Number(sample[0]?.bad ?? 0) > 0) {
    problems.push(`${Number(sample[0]!.bad)} Store row(s) still have an empty fulfillmentConfig`);
  }

  for (const name of [
    '15_phase_fulfillment_engine',
    '16_fulfillment_external_delivery_id_unique',
  ]) {
    const migRow = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "_prisma_migrations"
      WHERE migration_name = ${name} AND finished_at IS NOT NULL`;
    if (Number(migRow[0]?.n ?? 0) !== 1) {
      problems.push(`_prisma_migrations has no finished row for ${name}`);
    }
  }

  if (problems.length) {
    console.error('❌ fulfillment migration verification FAILED:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log(
    '✅ fulfillment migration verified — all columns, tables, indexes and backfill present.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
