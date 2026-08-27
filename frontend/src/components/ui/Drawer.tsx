'use client';

import { useEffect, type ReactNode } from 'react';

export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex h-full w-full max-w-sm flex-col bg-card shadow-xl"
      >
        {children}
      </div>
    </div>
  );
}
