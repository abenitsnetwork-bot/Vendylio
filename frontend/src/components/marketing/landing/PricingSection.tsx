'use client';

import { useState } from 'react';

// Figures match PlansSection / /pricing (hand-maintained, same convention —
// not read live from PlatformSettings). Feature bullets are the real Free vs
// Pro split (see /pricing for the full comparison), not the shorter generic
// list from the design reference, so nothing shipped today goes unmentioned.
export function PricingSection() {
  const [annual, setAnnual] = useState(false);

  return (
    <section id="pricing" className="pricing section-pad">
      <div className="pricing-heading lift">
        <h2>
          Start where you are.
          <br />
          <em>Grow from there.</em>
        </h2>
        <div className="billing" aria-label="Billing frequency">
          <button aria-pressed={!annual} onClick={() => setAnnual(false)}>
            Monthly
          </button>
          <button aria-pressed={annual} onClick={() => setAnnual(true)}>
            Yearly <span>Save $58</span>
          </button>
        </div>
      </div>
      <div className="plan-grid">
        <article className="plan">
          <div className="plan-top">
            <h3>Free</h3>
            <span>For your first next step</span>
          </div>
          <p className="price">
            <strong>$0</strong>
            <span>/ month</span>
          </p>
          <p className="fee">5% platform fee</p>
          <a className="plan-cta" href="/register">
            Open your store <span aria-hidden="true">↗</span>
          </a>
          <ul>
            <li>Unlimited products</li>
            <li>Your own storefront</li>
            <li>Card, Cash App &amp; Zelle payments</li>
            <li>Inventory and order tracking</li>
            <li>Pickup, self-delivery and courier options</li>
            <li>1 hero image · 5 AI descriptions / month</li>
          </ul>
        </article>
        <article className="plan plan-pro">
          <div className="plan-top">
            <h3>Pro</h3>
            <span>For your bigger picture</span>
          </div>
          <p className="price">
            <strong>{annual ? '$290' : '$29'}</strong>
            <span>/ {annual ? 'year' : 'month'}</span>
          </p>
          <p className="fee">1.5% platform fee</p>
          <a className="plan-cta" href="/register?plan=pro">
            Choose Pro <span aria-hidden="true">↗</span>
          </a>
          <p className="includes">Everything in Free, plus:</p>
          <ul>
            <li>Your own custom domain</li>
            <li>Advanced analytics</li>
            <li>Promo codes and discounts</li>
            <li>Team members</li>
            <li>Bank (ACH) payouts &amp; higher withdrawal limits</li>
            <li>Unlimited AI · 3 hero images · no Vendylio badge</li>
          </ul>
        </article>
      </div>
      <div className="pricing-fine">
        <p>
          Payment processing fees are separate. Platform fees also apply to Cash App and Zelle
          orders. Courier charges and availability vary.
        </p>
        <a className="text-link" href="/pricing">
          View full pricing details ↗
        </a>
      </div>
    </section>
  );
}
