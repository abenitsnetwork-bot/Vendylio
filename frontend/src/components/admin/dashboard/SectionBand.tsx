import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

/**
 * The Octoboard-style section wrapper: a dark forest-teal header strip
 * (--color-panel) with an uppercase title, over a light content area. The one
 * primitive that gives the redesigned admin dashboard its look while keeping
 * the rest of the app's light theme untouched.
 */
export function SectionBand({
  title,
  icon,
  meta,
  children,
  className,
}: {
  title: string;
  icon: IconName;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-6 overflow-hidden rounded-lg border border-border ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-3 bg-panel px-4 py-2.5 text-panel-foreground">
        <div className="flex items-center gap-2">
          <Icon i={icon} size={14} className="opacity-80" />
          <h2 className="text-xs font-bold uppercase tracking-[0.14em]">{title}</h2>
        </div>
        {meta != null && (
          <div className="text-[11px] font-medium uppercase tracking-wider text-panel-foreground/70">
            {meta}
          </div>
        )}
      </div>
      <div className="bg-card p-4">{children}</div>
    </section>
  );
}
