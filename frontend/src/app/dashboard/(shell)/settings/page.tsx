'use client';

import { sellerFirstName } from '@/lib/utils';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { StoreSettingsForm } from '@/components/seller/StoreSettingsForm';
import { StoreHoursForm, type StoreHoursEntry } from '@/components/seller/StoreHoursForm';
import { CategoryManager } from '@/components/seller/CategoryManager';
import { PaymentsConnectSettings } from '@/components/seller/PaymentsConnectSettings';
import { AccountSecurityForm } from '@/components/seller/AccountSecurityForm';
import type { StoreTemplate } from '@/lib/storeTemplates';

interface StoreDetails {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
  phone: string | null;
  cashAppCashtag: string | null;
  zelleContact: string | null;
  template: StoreTemplate;
  defaultLowStockThreshold: number;
  timezone: string;
  ordersPaused: boolean;
  pauseMessage: string | null;
  hours: StoreHoursEntry[];
}

const TABS = [
  { value: 'store', label: 'Store' },
  { value: 'hours', label: 'Hours & status' },
  { value: 'categories', label: 'Categories' },
  { value: 'payments', label: 'Payments' },
  { value: 'account', label: 'Account' },
] as const;
type Tab = (typeof TABS)[number]['value'];

function isTab(value: string | null): value is Tab {
  return TABS.some((t) => t.value === value);
}

// Phase 9 — consolidates what used to be three separate destinations (this
// page's old Store-only form, the never-built Stripe Connect UI, and
// /settings' account form) into one tabbed page, per the plan. "Business"
// (name/category/location) and a "Delivery" tab were in the original plan
// text too, but are intentionally left out here: Organization has no
// category/location fields anywhere else in the app to back a Business tab
// without inventing speculative schema, and Delivery already has a full
// dedicated page (/dashboard/delivery, fee config + queues) — a config-only
// echo of it here would just be the same form living in two menus.
function SettingsTabs() {
  const user = useUser();
  const { logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: Tab = isTab(tabParam) ? tabParam : 'store';

  const [store, setStore] = useState<StoreDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<{ store: StoreDetails }>('/api/stores/me')
      .then((res) => setStore(res.store))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load your store.');
      });
  }, [user]);

  if (!user) return null;

  function setTab(tab: Tab) {
    router.replace(`/dashboard/settings?tab=${tab}`);
  }

  return (
    <div className="min-h-screen bg-background font-body">
      <SellerHeader
        userName={sellerFirstName(user)}
        userEmail={user.email}
        onSignOut={async () => {
          await logout();
        }}
      />
      <div className="px-4 py-12 lg:px-14">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <Link
              href="/dashboard"
              className="mb-6 flex items-center gap-2 text-sm font-medium text-primary"
            >
              <Icon i="arrow-left" size={16} />
              Back to Dashboard
            </Link>
            <h1
              className="mb-2 font-headings font-bold text-foreground"
              style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
            >
              Settings
            </h1>
            <p className="text-base text-muted-foreground">
              Manage your store, payments, and account.
            </p>
          </div>

          <div className="mb-8 flex gap-2 border-b border-border">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setTab(tab.value)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold ${
                  activeTab === tab.value
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {activeTab === 'store' &&
            (!error && !store ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              store && (
                <StoreSettingsForm
                  store={store}
                  onSaved={(s) => setStore((prev) => (prev ? { ...prev, ...s } : prev))}
                />
              )
            ))}

          {activeTab === 'hours' &&
            (!error && !store ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              store && (
                <StoreHoursForm
                  ops={{
                    timezone: store.timezone,
                    ordersPaused: store.ordersPaused,
                    pauseMessage: store.pauseMessage,
                    hours: store.hours,
                  }}
                  onSaved={(next) => setStore((prev) => (prev ? { ...prev, ...next } : prev))}
                />
              )
            ))}

          {activeTab === 'categories' && <CategoryManager />}

          {activeTab === 'payments' && <PaymentsConnectSettings />}

          {activeTab === 'account' && <AccountSecurityForm user={user} />}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsTabs />
    </Suspense>
  );
}
