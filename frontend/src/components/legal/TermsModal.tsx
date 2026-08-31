'use client';

import { useEffect } from 'react';
import { TermsContent, TERMS_LAST_UPDATED } from '@/components/legal/TermsContent';

// Lightweight modal (no dialog lib — the codebase has none). Backdrop +
// Escape close, scrollable body. Used by the onboarding acceptance gate.
export function TermsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Terms of Service"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-headings text-lg font-bold text-foreground">Terms of Service</h2>
            <p className="text-xs text-muted-foreground">Last updated: {TERMS_LAST_UPDATED}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:bg-secondary"
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">
          <div className="space-y-6 text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:font-headings [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-foreground [&_li]:text-muted-foreground [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
            <TermsContent />
          </div>
        </div>
      </div>
    </div>
  );
}
