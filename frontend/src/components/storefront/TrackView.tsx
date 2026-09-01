'use client';

import { useEffect, useRef } from 'react';

// Phase 4a — storefront analytics beacon. Fires one POST /api/track on mount
// (store or product page view). Best-effort: uses navigator.sendBeacon when
// available (survives the page being closed), falls back to keepalive fetch.
// Never blocks render, never surfaces an error. Rendered only for the live
// storefront — pass `enabled={false}` for the owner's draft preview.

interface TrackViewProps {
  slug: string;
  kind: 'STORE' | 'PRODUCT';
  productId?: string;
  enabled?: boolean;
}

export function TrackView({ slug, kind, productId, enabled = true }: TrackViewProps) {
  const sent = useRef(false);

  useEffect(() => {
    if (!enabled || sent.current) return;
    sent.current = true;

    const payload = JSON.stringify(
      kind === 'PRODUCT' && productId ? { slug, kind, productId } : { slug, kind },
    );

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon('/api/track', blob)) return;
      }
    } catch {
      // fall through to fetch
    }

    void fetch('/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  }, [slug, kind, productId, enabled]);

  return null;
}
