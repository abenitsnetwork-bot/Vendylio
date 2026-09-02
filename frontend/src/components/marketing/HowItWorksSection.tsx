'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/Icon';

const STEPS: { num: string; icon: IconName; title: string; desc: string; chip: string }[] = [
  {
    num: '01',
    icon: 'store',
    title: 'Create your store',
    desc: 'Add your products, a photo, a link. Less than 5 minutes.',
    chip: 'linear-gradient(135deg, #0f9d8f, #1fbf6b)',
  },
  {
    num: '02',
    icon: 'share-2',
    title: 'Share your link',
    desc: 'One unique link to paste in your Instagram bio or WhatsApp group.',
    chip: 'linear-gradient(135deg, #1fbf6b, #46d17a)',
  },
  {
    num: '03',
    icon: 'credit-card',
    title: 'Get paid',
    desc: 'Cash App, Zelle, card — your customer pays however they want.',
    chip: 'linear-gradient(135deg, #f4a259, #ef8a3c)',
  },
  {
    num: '04',
    icon: 'truck',
    title: 'A courier delivers for you',
    desc: 'Activate same-day delivery. DoorDash or Uber Direct takes it from there.',
    chip: 'linear-gradient(135deg, #e07a3e, #dd5b2e)',
  },
];

export function HowItWorksSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [motionOk, setMotionOk] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setVisible(true);
      return;
    }
    setMotionOk(true);
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      id="how-it-works"
      className="border-t border-border bg-secondary px-4 py-16 font-body lg:px-14 lg:py-20"
    >
      <div className="mx-auto mb-12 max-w-7xl text-center lg:mb-14">
        <h2
          className="mb-3 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(26px, 4vw, 36px)', letterSpacing: '-0.8px' }}
        >
          How it works
        </h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          From zero to your first delivery in under an hour.
        </p>
        <Link href="/how-it-works" className="mt-3 inline-block text-sm font-medium text-accent">
          See the full walkthrough →
        </Link>
      </div>

      <div ref={ref} className="relative mx-auto max-w-7xl">
        {/* Animated path connecting steps 1 → 4 (desktop only) */}
        <span
          aria-hidden="true"
          className="absolute left-[12%] right-[12%] top-[1.15rem] hidden h-[3px] origin-left rounded-full lg:block"
          style={{
            background: 'linear-gradient(90deg, #0f9d8f, #46d17a, #f4a259, #dd5b2e)',
            transform: visible ? 'scaleX(1)' : 'scaleX(0)',
            transition: 'transform 900ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />

        {/* Glowing orb riding the line: 01 → 02 → 03 → 04, on a loop */}
        {visible && motionOk && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-[1.15rem] z-10 hidden h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white lg:block"
            style={{
              boxShadow:
                '0 0 16px 5px rgba(45, 212, 191, 0.85), 0 0 6px 2px rgba(255, 255, 255, 0.95)',
              animation: 'hiw-orb 4600ms cubic-bezier(0.55, 0, 0.45, 1) infinite',
              animationDelay: '700ms',
            }}
          />
        )}

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <div
              key={step.num}
              className="flex flex-col gap-4"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(16px)',
                transition: `opacity 500ms ease ${i * 140}ms, transform 500ms ease ${i * 140}ms`,
              }}
            >
              <div className="flex items-center gap-3">
                <span className="font-headings text-3xl font-bold text-accent">{step.num}</span>
                <div className="h-px flex-1 bg-border lg:hidden" />
              </div>
              <div
                className="flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-sm"
                style={{ background: step.chip }}
              >
                <Icon i={step.icon} size={20} className="text-white" />
              </div>
              <p className="font-headings text-base font-semibold text-foreground">{step.title}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
