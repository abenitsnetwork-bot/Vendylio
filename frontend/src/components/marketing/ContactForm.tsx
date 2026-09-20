'use client';

import { useState } from 'react';
import { guestCsrfHeaderValue } from '@/lib/guestCsrf';

const TOPICS = ['General question', 'Sales', 'Support', 'Billing', 'Press'];

const FIELD_CLASS =
  'w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none';

const EMPTY_FORM = { name: '', email: '', topic: TOPICS[0], message: '' };

export function ContactForm() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'busy') return;
    setState('busy');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': guestCsrfHeaderValue(),
        },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          topic: form.topic,
          message: form.message.trim(),
        }),
      });
      if (res.ok) {
        setState('done');
        setForm(EMPTY_FORM);
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center">
        <p className="font-headings text-lg font-bold text-foreground">Message sent</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Thanks for reaching out — we usually reply within a business day.
        </p>
        <button
          type="button"
          onClick={() => setState('idle')}
          className="mt-4 text-sm font-medium text-accent"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="contact-name"
            className="mb-1.5 block text-xs font-semibold text-foreground"
          >
            Name
          </label>
          <input
            id="contact-name"
            required
            maxLength={120}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={FIELD_CLASS}
            placeholder="Jane Doe"
          />
        </div>
        <div>
          <label
            htmlFor="contact-email"
            className="mb-1.5 block text-xs font-semibold text-foreground"
          >
            Email
          </label>
          <input
            id="contact-email"
            type="email"
            required
            maxLength={200}
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className={FIELD_CLASS}
            placeholder="you@example.com"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="contact-topic"
          className="mb-1.5 block text-xs font-semibold text-foreground"
        >
          Topic
        </label>
        <select
          id="contact-topic"
          value={form.topic}
          onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
          className={FIELD_CLASS}
        >
          {TOPICS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="contact-message"
          className="mb-1.5 block text-xs font-semibold text-foreground"
        >
          Message
        </label>
        <textarea
          id="contact-message"
          required
          maxLength={4000}
          rows={5}
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          className={`${FIELD_CLASS} resize-none`}
          placeholder="How can we help?"
        />
      </div>

      {state === 'error' && (
        <p className="text-sm text-red-600">Something went wrong. Try again.</p>
      )}

      <button
        type="submit"
        disabled={state === 'busy'}
        className="w-full rounded-full bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:w-auto"
      >
        {state === 'busy' ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}
