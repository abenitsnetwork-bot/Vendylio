'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { PaymentsConnectSettings } from '@/components/seller/PaymentsConnectSettings';

export default function PaymentsStepPage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1
          className="mb-2 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
        >
          Get paid online
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect your payment account so customers can pay for their orders with a card.
        </p>
      </div>

      <PaymentsConnectSettings />

      <div className="mt-6">
        <Button onClick={() => router.push('/onboarding/delivery')} className="sm:px-10">
          Continue
        </Button>
      </div>
    </div>
  );
}
