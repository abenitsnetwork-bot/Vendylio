import type { ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

export interface GuideStep {
  number: number;
  title: string;
  description: string;
  tips: string[];
}

export function GuideLayout({
  category,
  title,
  description,
  readTime,
  steps,
  extraContent,
  relatedGuides,
  ctaText,
  ctaHref,
}: {
  category: string;
  title: string;
  description: string;
  readTime: string;
  steps: GuideStep[];
  extraContent?: ReactNode;
  relatedGuides: { title: string; time: string; href: string }[];
  ctaText: string;
  ctaHref: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-12">
        <Link
          href="/dashboard/resources"
          className="mb-6 flex items-center gap-2 text-sm font-medium text-accent"
        >
          <Icon i="arrow-left" size={16} />
          Back to Resources
        </Link>

        <div className="mb-8">
          <span className="mb-4 inline-block rounded bg-secondary px-3 py-1 text-xs font-semibold text-accent">
            {category}
          </span>
          <h1
            className="mb-3 font-headings font-bold text-foreground"
            style={{ fontSize: 'clamp(28px, 5vw, 42px)', letterSpacing: '-1px' }}
          >
            {title}
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center gap-6 border-b border-border pb-8 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Icon i="clock" size={16} />
            {readTime}
          </div>
          <div className="flex items-center gap-2">
            <Icon i="bookmark" size={16} />
            Save for later
          </div>
          <div className="flex items-center gap-2">
            <Icon i="share-2" size={16} />
            Share
          </div>
        </div>
      </div>

      <div className="space-y-12">
        {steps.map((step) => (
          <div key={step.number} className="flex items-start gap-6">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-accent text-lg font-bold text-accent-foreground">
              {step.number}
            </div>
            <div className="flex-1 pt-1">
              <h2 className="mb-2 font-headings text-xl font-bold text-foreground">{step.title}</h2>
              <p className="mb-4 text-base text-muted-foreground">{step.description}</p>
              <div className="rounded-lg border border-border bg-secondary p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground">
                  Key Tips
                </p>
                <ul className="space-y-2">
                  {step.tips.map((tip) => (
                    <li key={tip} className="flex gap-2 text-sm text-muted-foreground">
                      <Icon i="check" size={16} className="mt-0.5 flex-shrink-0 text-accent" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>

      {extraContent}

      <div className="border-t border-border pt-12">
        <h3 className="mb-6 font-headings text-xl font-bold text-foreground">Related Guides</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {relatedGuides.map((guide) => (
            <Link
              key={guide.title}
              href={guide.href}
              className="rounded-lg border border-border p-4 text-left transition-colors hover:bg-secondary"
            >
              <p className="mb-1 text-sm font-semibold text-foreground">{guide.title}</p>
              <p className="text-xs text-muted-foreground">{guide.time}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-12 border-t border-border pt-8 text-center">
        <p className="mb-4 text-muted-foreground">Ready to get started?</p>
        <Link
          href={ctaHref}
          className="inline-block rounded-lg border border-border bg-secondary px-8 py-3 font-semibold text-foreground"
        >
          {ctaText}
        </Link>
      </div>
    </div>
  );
}
