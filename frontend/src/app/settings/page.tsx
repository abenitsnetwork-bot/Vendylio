// /settings — account-level controls.
//
// Two flows live here today:
//   1. Set / change password
//      - If the account was created via OAuth (hasPassword=false), the
//        "Set password" form calls POST /api/auth/set-password — no current
//        password required, because there isn't one.
//      - Otherwise the "Change password" form calls PUT /api/auth/change-password
//        with currentPassword + newPassword.
//   2. Link a provider (Google)
//      - When Google is not already linked, the button kicks the user to
//        GET /api/auth/oauth/google/start?next=/settings, which goes through
//        the normal OAuth dance and lands back on /settings linked.
//      - When already linked, we just show a "linked" pill — no unlink action
//        yet (would need a /api/auth/oauth/google/unlink endpoint with a
//        guard refusing to leave the user without any sign-in method).
//
// Phase 9: the actual form logic lives in AccountSecurityForm so the same
// component also powers the "Account" tab on /dashboard/settings — this
// page stays a separate route because the Google OAuth `next=/settings`
// redirect target is already baked into AccountSecurityForm.
'use client';

import { sellerFirstName } from '@/lib/utils';
import Link from 'next/link';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { AccountSecurityForm } from '@/components/seller/AccountSecurityForm';

export default function SettingsPage() {
  const user = useUser();
  const { logout } = useAuth();

  if (!user) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background px-4">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </main>
    );
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
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
        <div>
          <Link
            href="/dashboard"
            className="mb-6 flex items-center gap-2 text-sm font-medium text-primary"
          >
            <Icon i="arrow-left" size={16} />
            Retour au dashboard
          </Link>
          <h1
            className="mb-2 font-headings font-bold text-foreground"
            style={{ fontSize: '32px', letterSpacing: '-0.8px' }}
          >
            Sécurité & Profil
          </h1>
          <p className="text-sm text-muted-foreground">Connecté en tant que {user.email}</p>
        </div>

        <AccountSecurityForm user={user} />
      </main>
    </div>
  );
}
