'use client';

// Phase 7 — the customer progress stepper. Pure presentation: it renders
// whatever `buildOrderTimeline()` computed server-side (which already handles
// out-of-order / stale events — §157 keeps that logic off the client).
//
// Accessible: an ordered list, each step's state in its text (not colour
// alone — §38/§175), current step marked aria-current.

interface TimelineStep {
  key: string;
  label: string;
  state: 'done' | 'current' | 'upcoming';
  at: string | null;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATE_LABEL: Record<TimelineStep['state'], string> = {
  done: 'Completed',
  current: 'In progress',
  upcoming: 'Not started',
};

export function OrderTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="relative ml-2 border-l border-border">
      {steps.map((step) => {
        const dot =
          step.state === 'done'
            ? 'bg-primary border-primary'
            : step.state === 'current'
              ? 'bg-background border-primary'
              : 'bg-background border-border';
        return (
          <li
            key={step.key}
            className="mb-5 ml-4 last:mb-0"
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span
              className={`absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 ${dot}`}
              aria-hidden="true"
            />
            <p
              className={`text-sm ${
                step.state === 'upcoming'
                  ? 'text-muted-foreground'
                  : 'font-semibold text-foreground'
              }`}
            >
              {step.label}
              <span className="sr-only"> — {STATE_LABEL[step.state]}</span>
            </p>
            {step.at && <p className="text-xs text-muted-foreground">{formatTime(step.at)}</p>}
          </li>
        );
      })}
    </ol>
  );
}
