'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { StarRatingInput } from '@/components/ui/StarRating';
import { SellerHeader } from '@/components/seller/SellerHeader';

export default function TestimonialPage() {
  const user = useUser();
  const { logout } = useAuth();

  const [quote, setQuote] = useState('');
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (quote.trim().length < 10) {
      setError('Tell us a little more — at least a sentence.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api('/api/testimonials', {
        method: 'POST',
        body: { quote: quote.trim(), ...(rating > 0 ? { rating } : {}) },
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background font-body">
      <SellerHeader
        userName={sellerFirstName(user)}
        userEmail={user.email}
        onSignOut={async () => {
          await logout();
        }}
      />
      <div className="px-4 py-12 lg:px-14">
        <div className="mx-auto max-w-xl">
          <Link
            href="/dashboard"
            className="mb-6 flex items-center gap-2 text-sm font-medium text-accent"
          >
            <Icon i="arrow-left" size={16} />
            Back to Dashboard
          </Link>
          <h1
            className="mb-2 font-headings font-bold text-foreground"
            style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
          >
            Share your story
          </h1>
          <p className="mb-8 text-base text-muted-foreground">
            Enjoying Vendylio? A few words from you could end up on our homepage and help another
            seller take the leap. Our team reviews every submission before it goes live.
          </p>

          {done ? (
            <Card className="p-8 text-center">
              <Icon i="check-circle" size={32} className="mx-auto mb-3 text-accent" />
              <p className="mb-1 font-headings text-lg font-bold text-foreground">Thank you!</p>
              <p className="text-sm text-muted-foreground">
                Your testimonial is with our team. If we feature it, you&apos;ll see it on the
                Vendylio homepage.
              </p>
            </Card>
          ) : (
            <form onSubmit={onSubmit}>
              <Card className="space-y-6 p-8">
                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">
                    Your rating{' '}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </p>
                  <StarRatingInput value={rating} onChange={setRating} />
                </div>

                <Field label="Your testimonial" htmlFor="quote">
                  <textarea
                    id="quote"
                    className={`${inputClass} min-h-32`}
                    maxLength={1000}
                    value={quote}
                    onChange={(e) => setQuote(e.target.value)}
                    placeholder="Before Vendylio I was juggling orders on WhatsApp. Now everything's in one place and I've doubled my sales."
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    We&apos;ll show it with your name and store — {quote.length}/1000.
                  </p>
                </Field>

                {error && (
                  <p role="alert" className="text-sm text-red-600">
                    {error}
                  </p>
                )}

                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send testimonial'}
                </Button>
              </Card>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
