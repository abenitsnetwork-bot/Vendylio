import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'accent' | 'outline' | 'dark';

const VARIANT_CLASSES: Record<Variant, string> = {
  // The default call-to-action is soft sage (`--color-secondary`) with a
  // border for definition. `accent` keeps the brand coral for the rare spot
  // that wants it; `dark` is the near-black escape hatch.
  primary: 'bg-secondary text-foreground border border-border hover:bg-border',
  accent: 'bg-accent text-accent-foreground hover:opacity-90',
  outline: 'bg-card text-foreground border border-border hover:bg-secondary',
  dark: 'bg-foreground text-background hover:opacity-90',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
}
