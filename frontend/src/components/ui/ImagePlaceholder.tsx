import { Icon, type IconName } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * Stand-in for Banani's AI-generated placeholder art (`@global/Image` /
 * `@global/UserAvatar`), which has no real asset behind it. Swap for real
 * product/profile photos once available.
 */
export function ImagePlaceholder({
  icon = 'store',
  className,
  rounded = false,
}: {
  icon?: IconName;
  className?: string;
  rounded?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex items-center justify-center bg-gradient-to-br from-secondary to-muted',
        rounded && 'rounded-full',
        className,
      )}
    >
      <Icon i={icon} size={28} className="text-muted-foreground" />
    </div>
  );
}
