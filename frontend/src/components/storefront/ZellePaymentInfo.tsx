'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';

/** Zelle has no cross-bank deep-link/QR standard the way Cash App does — a
 * buyer sends money to this contact from inside their own banking app, so
 * this is plain text (with a copy button) rather than a fabricated QR code. */
export function ZellePaymentInfo({ contact }: { contact: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(contact);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the contact is
      // still visible as plain text for the buyer to type/copy manually.
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-center">
      <p className="mb-1 text-sm font-semibold text-foreground">Pay with Zelle</p>
      <p className="mb-4 text-xs text-muted-foreground">
        Send the exact amount to this contact from your bank&apos;s Zelle option.
      </p>
      <div className="flex items-center justify-center gap-2">
        <span className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-foreground">
          {contact}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy Zelle contact"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground hover:bg-secondary"
        >
          <Icon i={copied ? 'check' : 'clipboard'} size={16} />
        </button>
      </div>
      {copied && <p className="mt-2 text-xs text-primary">Copied!</p>}
    </div>
  );
}
