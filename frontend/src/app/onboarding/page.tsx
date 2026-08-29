'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from './layout';

/**
 * `/onboarding` itself has no fields — it's a resume-redirector. A returning
 * merchant always lands on their first incomplete required step instead of
 * restarting from Business (section 17 of the onboarding spec).
 */
export default function OnboardingIndexPage() {
  const { progress } = useOnboarding();
  const router = useRouter();

  useEffect(() => {
    router.replace(progress.resumeRoute);
  }, [progress.resumeRoute, router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading your setup…</p>
    </div>
  );
}
