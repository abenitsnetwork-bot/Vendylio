'use client';

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

/* --- Per-step CSS mini-mockups (no assets — div-built, on-brand) --- */

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="aspect-[16/10] w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex h-full w-full flex-col bg-gradient-to-br from-secondary to-muted">
        {children}
      </div>
    </div>
  );
}

function StoreMock() {
  return (
    <Frame>
      <div className="flex h-full flex-col gap-2 p-3">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="h-2 w-16 rounded bg-foreground/15" />
        </div>
        <div className="grid flex-1 grid-cols-2 gap-2">
          {[0, 1].map((k) => (
            <div key={k} className="flex flex-col gap-1 rounded-lg bg-card p-1.5 shadow-sm">
              <span className="flex-1 rounded bg-muted" />
              <span className="h-1.5 w-10 rounded bg-foreground/20" />
              <span className="h-1.5 w-6 rounded bg-accent/70" />
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

function LinkMock() {
  return (
    <Frame>
      <div className="flex h-full flex-col items-center justify-center gap-2.5 p-4">
        <div className="flex w-full items-center gap-1.5 rounded-full bg-card px-2.5 py-1.5 shadow-sm">
          <Icon i="link" size={11} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-[10px] font-medium text-foreground">
            vendylio.com/s/your-store
          </span>
        </div>
        <div className="flex gap-2">
          {(['message-circle', 'share-2', 'mail'] as const).map((n) => (
            <span
              key={n}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-card shadow-sm"
            >
              <Icon i={n} size={13} className="text-accent" />
            </span>
          ))}
        </div>
      </div>
    </Frame>
  );
}

function PaymentMock() {
  return (
    <Frame>
      <div className="flex h-full items-center justify-center p-4">
        <div className="flex w-full items-center gap-2.5 rounded-xl bg-card p-3 shadow-sm">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: '#1fbf6b' }}
          >
            <Icon i="check" size={16} className="text-white" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">Payment received</p>
            <p className="text-[10px] text-muted-foreground">$36.00 · Paid</p>
          </div>
        </div>
      </div>
    </Frame>
  );
}

function DeliveryMock() {
  return (
    <Frame>
      <div className="flex h-full flex-col justify-center gap-2.5 p-4">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: 'linear-gradient(135deg, #e07a3e, #dd5b2e)' }}
          >
            <Icon i="truck" size={15} className="text-white" />
          </span>
          <div>
            <p className="text-xs font-semibold text-foreground">Out for delivery</p>
            <p className="text-[10px] text-muted-foreground">Arrives in ~25 min</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {[0, 1, 2, 3].map((k) => (
            <span
              key={k}
              className="h-1 flex-1 rounded-full"
              style={{ background: k < 3 ? '#dd5b2e' : 'var(--color-border)' }}
            />
          ))}
        </div>
      </div>
    </Frame>
  );
}

const STEPS: { num: string; title: string; desc: string; mock: ReactNode }[] = [
  {
    num: '01',
    title: 'Create your store',
    desc: 'Add your products, a photo, a link. Less than 5 minutes.',
    mock: <StoreMock />,
  },
  {
    num: '02',
    title: 'Share your link',
    desc: 'One unique link to paste in your Instagram bio or WhatsApp group.',
    mock: <LinkMock />,
  },
  {
    num: '03',
    title: 'Get paid',
    desc: 'Cash App, Zelle, card — your customer pays however they want.',
    mock: <PaymentMock />,
  },
  {
    num: '04',
    title: 'A courier delivers for you',
    desc: 'Activate same-day delivery. DoorDash or Uber Direct takes it from there.',
    mock: <DeliveryMock />,
  },
];

function reveal(visible: boolean, from: 'left' | 'right', delay: number): CSSProperties {
  return {
    opacity: visible ? 1 : 0,
    transform: visible ? 'none' : `translateX(${from === 'left' ? '-24px' : '24px'})`,
    transition: `opacity 550ms ease ${delay}ms, transform 550ms cubic-bezier(0.4,0,0.2,1) ${delay}ms`,
  };
}

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
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      id="how-it-works"
      className="border-t border-border bg-secondary px-4 py-16 font-body lg:px-14 lg:py-20"
    >
      <div className="mx-auto mb-12 max-w-7xl text-center lg:mb-16">
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

      <div ref={ref} className="relative mx-auto max-w-5xl">
        {/* Desktop centre timeline — draws in on scroll */}
        <span
          aria-hidden="true"
          className="absolute bottom-10 left-1/2 top-3 hidden w-[3px] -translate-x-1/2 rounded-full bg-panel lg:block"
          style={{
            transformOrigin: 'top',
            transform: visible ? 'scaleY(1)' : 'scaleY(0)',
            transition: 'transform 1000ms cubic-bezier(0.4,0,0.2,1)',
          }}
        />

        <ol className="space-y-12 lg:space-y-16">
          {STEPS.map((step, i) => {
            const flip = i % 2 === 1; // odd steps: visual on the left
            return (
              <li
                key={step.num}
                className="relative grid grid-cols-1 items-center gap-6 lg:grid-cols-2 lg:gap-16"
              >
                {/* Node on the centre line — pulses in sequence, on a loop */}
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-6 hidden h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-accent ring-4 ring-secondary lg:block"
                  style={
                    motionOk
                      ? { animation: `hiw-node 4000ms ease-in-out ${i * 500}ms infinite` }
                      : undefined
                  }
                />

                {/* Text */}
                <div
                  className={flip ? 'lg:order-2 lg:pl-14' : 'lg:order-1 lg:pr-14 lg:text-right'}
                  style={reveal(visible, flip ? 'right' : 'left', i * 90)}
                >
                  <div className={`mb-3 flex items-end gap-3 ${flip ? '' : 'lg:flex-row-reverse'}`}>
                    <span
                      className="font-headings font-bold leading-none text-accent"
                      style={{ fontSize: 'clamp(40px, 7vw, 52px)', letterSpacing: '-2px' }}
                    >
                      {step.num}
                    </span>
                    <span
                      className="mb-2 h-0.5 flex-1 origin-left rounded bg-panel/30"
                      style={{
                        transform: visible ? 'scaleX(1)' : 'scaleX(0)',
                        transition: `transform 600ms ease ${i * 90 + 200}ms`,
                      }}
                    />
                  </div>
                  <h3
                    className="mb-2 font-headings font-bold text-foreground"
                    style={{ fontSize: 'clamp(18px, 3vw, 22px)', letterSpacing: '-0.6px' }}
                  >
                    {step.title}
                  </h3>
                  <p
                    className={`text-sm leading-relaxed text-muted-foreground lg:max-w-sm ${
                      flip ? '' : 'lg:ml-auto'
                    }`}
                  >
                    {step.desc}
                  </p>
                </div>

                {/* Visual */}
                <div
                  className={flip ? 'lg:order-1 lg:pr-14' : 'lg:order-2 lg:pl-14'}
                  style={reveal(visible, flip ? 'left' : 'right', i * 90 + 60)}
                >
                  {step.mock}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
