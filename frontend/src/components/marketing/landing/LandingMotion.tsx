'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

// Root wrapper for the redesigned homepage. Two jobs:
//
// 1. Scopes every `.vendylio-landing …` rule in landing.css to this subtree —
//    the ported stylesheet has no bare `html`/`body`/`h2` selectors, so
//    nothing here can leak into dashboard/admin/storefront routes.
// 2. Wires the page's scroll-driven motion (GSAP ScrollTrigger + Lenis smooth
//    scroll for the `.parallax-image` drift and `.lift` reveal), scoped to
//    this page only and torn down on unmount. Ported from the design
//    reference's routes/index.tsx. Under `prefers-reduced-motion: reduce`
//    neither GSAP nor Lenis is instantiated — content renders in its resting
//    state with native (instant) scrolling, matching scroll-scrub.css's own
//    reduced-motion rules for the hero film.
export function LandingMotion({ children }: { children: ReactNode }) {
  const page = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Scoped stand-in for the reference's global `html{scroll-padding-top}` —
    // applied only while this page is mounted so in-page anchor jumps clear
    // the sticky nav, then removed on unmount (never a global page rule).
    const mql = window.matchMedia('(max-width: 700px)');
    const applyScrollPadding = () => {
      root.style.scrollPaddingTop = mql.matches ? '20px' : '90px';
    };
    applyScrollPadding();
    mql.addEventListener('change', applyScrollPadding);

    const cleanupScrollPadding = () => {
      mql.removeEventListener('change', applyScrollPadding);
      root.style.removeProperty('scroll-padding-top');
      root.style.removeProperty('scroll-behavior');
    };

    if (reduceMotion) {
      root.style.scrollBehavior = 'auto';
      return cleanupScrollPadding;
    }

    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ autoRaf: false, anchors: true, duration: 1.05 });
    const tick = (t: number) => lenis.raf(t * 1000);
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(tick);

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('.parallax-image').forEach((el) =>
        gsap.fromTo(
          el,
          { yPercent: -5 },
          {
            yPercent: 5,
            ease: 'none',
            scrollTrigger: {
              trigger: el.parentElement,
              start: 'top bottom',
              end: 'bottom top',
              scrub: true,
            },
          },
        ),
      );
      gsap.utils.toArray<HTMLElement>('.lift').forEach((el) =>
        gsap.fromTo(
          el,
          { y: 30 },
          {
            y: 0,
            duration: 0.9,
            ease: 'power3.out',
            scrollTrigger: { trigger: el, start: 'top 92%', once: true },
          },
        ),
      );
    }, page);

    return () => {
      ctx.revert();
      gsap.ticker.remove(tick);
      lenis.destroy();
      cleanupScrollPadding();
    };
  }, []);

  return (
    <div className="vendylio-landing" ref={page}>
      {children}
    </div>
  );
}
