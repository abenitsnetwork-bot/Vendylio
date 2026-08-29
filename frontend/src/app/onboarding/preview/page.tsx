'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useOnboarding } from '../layout';

export default function PreviewStepPage() {
  const { store } = useOnboarding();
  const router = useRouter();

  if (!store) return null;
  const storeUrl = `/s/${store.slug}`;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1
          className="mb-2 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
        >
          Preview your store
        </h1>
        <p className="text-sm text-muted-foreground">
          This is your real store — exactly what customers will see.
        </p>
      </div>

      <Card className="mb-6 flex items-center gap-4 p-6">
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary">
          {store.logoUrl ? (
            <img src={store.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon i="store" size={24} className="text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-headings text-lg font-bold text-foreground">{store.name}</p>
          <p className="truncate text-sm text-muted-foreground">vendylio.com{storeUrl}</p>
        </div>
      </Card>

      <a
        href={storeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl border border-primary px-6 py-3 text-sm font-semibold text-primary hover:bg-secondary"
      >
        View My Store <Icon i="arrow-right" size={16} />
      </a>

      <Button onClick={() => router.push('/onboarding/launch')} className="sm:px-10">
        Continue to Launch
      </Button>
    </div>
  );
}
