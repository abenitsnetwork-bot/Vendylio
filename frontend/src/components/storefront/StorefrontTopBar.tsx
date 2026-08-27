import { Icon } from '@/components/ui/Icon';

/** Contact bar shown above the header on every storefront page — only
 * renders when the seller has set a phone number (Store.phone), so a store
 * without one keeps the exact layout it had before this existed. */
export function StorefrontTopBar({ phone }: { phone: string | null }) {
  if (!phone) return null;

  return (
    <div className="bg-panel px-4 py-2 text-panel-foreground lg:px-14">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 text-xs sm:justify-start">
        <Icon i="phone" size={13} />
        <a href={`tel:${phone}`} className="font-medium hover:underline">
          {phone}
        </a>
      </div>
    </div>
  );
}
