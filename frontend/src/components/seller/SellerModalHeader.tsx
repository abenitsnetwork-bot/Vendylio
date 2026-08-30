import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

/** Shared header for the onboarding / add-product / success screens — each
 * defines this identical bar inline in the Banani source; extracted here
 * since three screens repeat it verbatim. */
export function SellerModalHeader({ closeHref }: { closeHref: string }) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-4 py-4 lg:px-14">
      <img src="/logo.png" alt="Vendylio" className="h-7 w-auto" />
      <Link href={closeHref} className="text-muted-foreground" aria-label="Close">
        <Icon i="x" size={18} />
      </Link>
    </header>
  );
}
