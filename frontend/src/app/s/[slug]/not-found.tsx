import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

// Shown when a storefront or product read returns null (unknown slug,
// unpublished store, archived/foreign product). Customer-facing copy — no
// technical detail, no hint about whether the store merely exists.
export default function StorefrontNotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center font-body">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        <Icon i="store" size={24} className="text-muted-foreground" />
      </div>
      <h1
        className="mb-2 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(22px, 4vw, 28px)' }}
      >
        Store not found
      </h1>
      <p className="mb-8 text-sm text-muted-foreground">
        The store you&apos;re looking for doesn&apos;t exist or is no longer available.
      </p>
      <Link
        href="/"
        className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Go to Vendylio
      </Link>
    </div>
  );
}
