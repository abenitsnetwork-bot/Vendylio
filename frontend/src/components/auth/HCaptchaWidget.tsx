'use client';

import { useEffect, useRef } from 'react';

// Minimal hCaptcha widget — no npm dependency (same posture as the rest of
// this starter). Renders nothing and resolves immediately when
// NEXT_PUBLIC_HCAPTCHA_SITE_KEY is unset, so dev / headless forms are never
// blocked. The server (`verifyCaptcha`) is the real gate.

const SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
const SCRIPT_SRC = 'https://js.hcaptcha.com/1/api.js?render=explicit';

interface HCaptchaApi {
  render: (
    el: HTMLElement,
    opts: { sitekey: string; callback: (t: string) => void; 'expired-callback': () => void },
  ) => string;
  reset: (id?: string) => void;
}

declare global {
  interface Window {
    hcaptcha?: HCaptchaApi;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.hcaptcha) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('hCaptcha script failed to load'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function hcaptchaEnabled(): boolean {
  return Boolean(SITE_KEY);
}

export function HCaptchaWidget({
  onVerify,
  resetSignal = 0,
}: {
  onVerify: (token: string) => void;
  /** Bump this number to force the widget to reset (e.g. after CAPTCHA_FAILED). */
  resetSignal?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;

  useEffect(() => {
    if (!SITE_KEY) {
      onVerifyRef.current('');
      return;
    }
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.hcaptcha) return;
        if (widgetIdRef.current !== null) return;
        widgetIdRef.current = window.hcaptcha.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (t) => onVerifyRef.current(t),
          'expired-callback': () => onVerifyRef.current(''),
        });
      })
      .catch(() => {
        /* script blocked — leave the token empty; server decides */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current !== null && window.hcaptcha) {
      window.hcaptcha.reset(widgetIdRef.current);
      onVerifyRef.current('');
    }
  }, [resetSignal]);

  if (!SITE_KEY) return null;
  return <div ref={containerRef} className="min-h-[78px]" />;
}
