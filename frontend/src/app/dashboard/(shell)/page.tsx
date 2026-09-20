// Dashboard home — Server Component. Was a client-fetched page (useEffect +
// api() calls, with a full-screen "Loading your dashboard…" placeholder in
// the meantime); every visit re-ran that fetch-then-swap cycle, which read
// as "loads an old page before completing with other metrics." Converted to
// SSR, same pattern already used by src/app/admin/layout.tsx (requireAuth()
// / requireAdmin() read the auth cookie via next/headers internally, so they
// work from a Server Component with no `req`, not just Route Handlers) — all
// data is ready before the first paint, so there's nothing left to flash.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/server/middleware';
import { getDashboardOverview } from '@/lib/server/dashboard/overview';
import { computeOnboardingProgress } from '@/lib/onboardingProgress';
import { sellerFirstName } from '@/lib/utils';
import { SellerDashboard } from '@/components/seller/SellerDashboard';

export default async function DashboardPage() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) redirect('/login?next=/dashboard');

  const overview = await getDashboardOverview(auth.user.sub);
  if (!overview) redirect('/onboarding');

  const progress = computeOnboardingProgress(overview.store, overview.stats.productCount);

  return (
    <SellerDashboard
      greetingName={sellerFirstName({ name: overview.userName, email: auth.user.email })}
      userEmail={auth.user.email}
      store={overview.store}
      stats={overview.stats}
      openState={overview.openState}
      recentOrders={overview.recentOrders}
      weeklySales={overview.weeklySales}
      fulfillmentRatePct={overview.fulfillmentRatePct}
      published={progress.launched}
      progress={progress}
    />
  );
}
