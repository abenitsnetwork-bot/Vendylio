// Shared plan indicator — orange (brand coral) for Free, green for Pro.
// Used on the admin store overview / list. The seller dashboard renders its
// own linked button with the same colour logic.

export function PlanBadge({ plan, className = '' }: { plan: string | null; className?: string }) {
  const isPro = plan === 'PRO';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        isPro ? 'bg-green-100 text-green-700' : 'bg-accent/10 text-accent'
      } ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isPro ? 'bg-green-600' : 'bg-accent'}`}
        aria-hidden="true"
      />
      {isPro ? 'Pro' : 'Free'}
    </span>
  );
}
