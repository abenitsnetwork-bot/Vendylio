'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// When a SUPERADMIN has issued a one-time temporary password, the user can
// sign in but must immediately choose a real one. This gate lives in the
// authed shells and bounces them to /settings until they do. The settings
// page shows the "set a new password" banner off the same `mustChangePassword`
// flag; change-password / reset-password clear it server-side.
export function ForcePasswordChange() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (user?.mustChangePassword && pathname !== '/settings') {
      router.replace('/settings?reason=temp-password');
    }
  }, [user?.mustChangePassword, pathname, router]);

  return null;
}
