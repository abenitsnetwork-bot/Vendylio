'use client';

import { useState } from 'react';
import type { LandingImage } from '@/lib/server/landing';
import type { SiteImageKey } from '@/lib/siteImageKeys';

interface Step {
  key: Extract<
    SiteImageKey,
    'hiw_step_create' | 'hiw_step_share' | 'hiw_step_paid' | 'hiw_step_delivery'
  >;
  title: string;
  short: string;
  body: string;
  tag: string;
  fallbackImage: string;
  alt: string;
}

const STEPS: Step[] = [
  {
    key: 'hiw_step_create',
    title: 'Make it yours.',
    short: 'Create your store',
    body: 'Give your business a home online. Add your products, choose a theme and build a storefront that feels like you.',
    tag: 'A storefront with your name on it',
    fallbackImage: '/assets/landing/storefront.jpg',
    alt: 'Store builder illustration from Vendylio',
  },
  {
    key: 'hiw_step_share',
    title: 'Share one link.',
    short: 'Share your link',
    body: 'Put your store in your Instagram bio, send it on WhatsApp, or share it with a customer. One link to everything you sell.',
    tag: 'From your community to your checkout',
    fallbackImage: '/assets/landing/editorial.webp',
    alt: 'Products ready to be added to a store',
  },
  {
    key: 'hiw_step_paid',
    title: 'Let orders come together.',
    short: 'Accept payments',
    body: 'Offer card payments, Cash App or Zelle. Direct transfers are confirmed manually, so you stay in control of each order.',
    tag: 'Payments that fit the way you sell',
    fallbackImage: '/assets/landing/scene-01-poster.png',
    alt: 'An entrepreneur reviewing her business ledger',
  },
  {
    key: 'hiw_step_delivery',
    title: 'Get it to their door.',
    short: 'Fulfil the order',
    body: 'Let customers pick up, deliver it yourself, or use a supported local courier where available.',
    tag: 'Your products. Their next delivery.',
    fallbackImage: '/assets/landing/fulfillment.jpg',
    alt: 'Preparing products for a customer',
  },
];

export function JourneySteps({ images }: { images: Partial<Record<SiteImageKey, LandingImage>> }) {
  const [step, setStep] = useState(0);
  const active = STEPS[step]!;
  const activeImage = images[active.key];

  return (
    <section id="how-it-works" className="how section-pad">
      <div className="how-heading lift">
        <h2>
          A few steps.
          <br />
          <em>A new beginning.</em>
        </h2>
        <p>
          Everything starts with your store.
          <br />
          Here&rsquo;s where it goes next.
        </p>
      </div>
      <div className="journey-grid">
        <div className="steps">
          {STEPS.map((item, i) => (
            <div key={item.key} className={i === step ? 'step active' : 'step'}>
              <button
                onClick={() => setStep(i)}
                aria-expanded={i === step}
                aria-controls={`step-${i}`}
              >
                <span className="step-num">0{i + 1}</span>
                <span>{item.short}</span>
                <span className="step-arrow" aria-hidden="true">
                  {i === step ? '−' : '+'}
                </span>
              </button>
              <div id={`step-${i}`} hidden={i !== step}>
                <p>{item.body}</p>
              </div>
            </div>
          ))}
          <a className="text-link journey-link" href="/register">
            Open your store <span aria-hidden="true">↗</span>
          </a>
        </div>
        <figure className="journey-visual" key={step}>
          <img
            src={activeImage?.url ?? active.fallbackImage}
            alt={activeImage?.altText ?? active.alt}
            loading="lazy"
          />
          <figcaption>
            <span>{active.tag}</span>
            <h3>{active.title}</h3>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
