'use client';

import { useState } from 'react';
import { guestCsrfHeaderValue } from '@/lib/guestCsrf';

// Phase 5 — the /pricing "Business" teaser's inline waitlist form (replaces
// the bare mailto:). Posts to the public /api/business-waitlist.

export function BusinessWaitlistForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'busy') return;
    setState('busy');
    try {
      const res = await fetch('/api/business-waitlist', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': guestCsrfHeaderValue(),
        },
        body: JSON.stringify({ email: email.trim() }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p className="mt-3 text-sm font-medium text-primary">
        You&apos;re on the list — we&apos;ll email you when Business opens.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-3 flex max-w-sm flex-col gap-2 sm:flex-row">
      <input
        type="email"
        required
        placeholder="you@business.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={state === 'busy'}
        className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {state === 'busy' ? 'Sending…' : 'Notify me'}
      </button>
      {state === 'error' && (
        <p className="w-full text-xs text-red-600 sm:mt-1">Something went wrong. Try again.</p>
      )}
    </form>
  );
}
