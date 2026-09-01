// Phase 1a — daily safety net that retires Pro access the webhooks can miss:
//   1. A comped store (pilot) whose `planCompExpiresAt` has passed.
//   2. A subscription that went PAST_DUE and never recovered — once its
//      current period end is also in the past, the grace window is over.
//
// The happy paths (cancel, hard payment failure) are handled live by
// syncSubscriptionFromStripe; this only catches the stragglers, so on a
// healthy system it does nothing most days.
import 'server-only';
import type { PrismaClient } from '@prisma/client';

type SweepPrisma = Pick<PrismaClient, 'store'>;

export interface SweepResult {
  compExpired: number;
  subscriptionLapsed: number;
}

export async function sweepExpiredPlans(
  prisma: SweepPrisma,
  now: Date = new Date(),
): Promise<SweepResult> {
  const compExpired = await prisma.store.updateMany({
    where: {
      plan: 'PRO',
      planSource: 'COMP',
      planCompExpiresAt: { lt: now },
    },
    data: { plan: 'FREE', planSource: null, planCompExpiresAt: null },
  });

  const subscriptionLapsed = await prisma.store.updateMany({
    where: {
      plan: 'PRO',
      planSource: 'SUBSCRIPTION',
      subscriptionStatus: 'PAST_DUE',
      subscriptionCurrentPeriodEnd: { lt: now },
    },
    data: { plan: 'FREE', planSource: null, subscriptionStatus: 'CANCELED' },
  });

  return {
    compExpired: compExpired.count,
    subscriptionLapsed: subscriptionLapsed.count,
  };
}
