'use client';

import { useState } from 'react';
import type { LandingImage } from '@/lib/server/landing';

const METHODS = [
  {
    label: 'Customer pickup',
    title: 'A familiar face.',
    body: 'Make your store the meeting point. Offer pickup and give customers a way to collect their order.',
  },
  {
    label: 'Self-delivery',
    title: 'Your own route.',
    body: 'Handle local deliveries yourself. Keep the journey from your store to your customer in your hands.',
  },
  {
    label: 'Local courier',
    title: 'A little help, locally.',
    body: 'Use DoorDash or Uber Direct where supported. Courier availability and delivery charges depend on the order and location.',
  },
];

export function DeliveryMethods({ image }: { image?: LandingImage | undefined }) {
  const [method, setMethod] = useState(0);
  const active = METHODS[method]!;

  return (
    <section id="delivery" className="delivery">
      <div className="delivery-photo">
        <img
          className="parallax-image"
          src={image?.url ?? '/assets/landing/fulfillment.jpg'}
          alt={image?.altText ?? "Preparing products for a customer's delivery"}
          loading="lazy"
        />
        <span className="photo-label">THE LAST MILE MATTERS.</span>
      </div>
      <div className="delivery-copy">
        <h2>
          Good things
          <br />
          deserve to
          <br />
          <em>go places.</em>
        </h2>
        <div className="delivery-tabs" aria-label="Delivery options">
          {METHODS.map((m, i) => (
            <button
              key={m.label}
              aria-pressed={method === i}
              className={method === i ? 'selected' : ''}
              onClick={() => setMethod(i)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="delivery-detail" aria-live="polite">
          <h3>{active.title}</h3>
          <p>{active.body}</p>
        </div>
      </div>
    </section>
  );
}
