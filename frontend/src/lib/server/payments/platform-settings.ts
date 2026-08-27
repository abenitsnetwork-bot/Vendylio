// Read helper for the PlatformSettings singleton row (id "default"). Used
// by both real-payment commission calc (markPaid.ts) and the Stripe Connect
// checkout path (api/orders/route.ts) so they never drift from what an
// admin configured in /admin/settings — previously each read
// COMMISSION_RATE_BP/_PRO from process.env independently, and a change
// required redeploying instead of just saving a form.
import 'server-only';
import type { PrismaClient } from '@prisma/client';

export interface PlatformCommissionRates {
  baseRateBp: number;
  proRateBp: number | null;
}

const SETTINGS_ID = 'default';

export type PlatformSettingsClient = Pick<PrismaClient, 'platformSettings'>;

/** No row yet (fresh install, nobody has visited /admin/settings) = 0% commission, no PRO discount. */
export async function getPlatformCommissionRates(
  client: PlatformSettingsClient,
): Promise<PlatformCommissionRates> {
  const row = await client.platformSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!row) return { baseRateBp: 0, proRateBp: null };
  return { baseRateBp: row.commissionRateBp, proRateBp: row.commissionRateBpPro };
}
