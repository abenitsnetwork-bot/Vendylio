'use client';

import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

type Method = 'CASH_APP' | 'ZELLE' | 'BANK';

const ERROR_MESSAGES: Record<string, string> = {
  AMOUNT_BELOW_MIN: 'That amount is below the minimum withdrawal.',
  AMOUNT_ABOVE_MAX: 'That amount is above the maximum withdrawal.',
  DAILY_LIMIT_EXCEEDED: "You've hit today's withdrawal limit.",
  COOLDOWN_ACTIVE: 'Please wait before requesting another withdrawal.',
  PIN_INVALID: 'Incorrect PIN.',
  INSUFFICIENT_BALANCE:
    'Insufficient balance. Note: balance tracking isn’t linked to store sales yet in this build, so it stays at $0 until checkout is wired to your store.',
  BANK_PAYOUT_UNAVAILABLE:
    'Bank payouts need a fully onboarded Stripe account. Use Cash App or Zelle for now.',
  VALIDATION_FAILED: 'Please check the fields and try again.',
};

interface WithdrawalResult {
  netAmount: number;
  grossAmount: number;
  commissionSettledCents: number;
}

export function WithdrawalRequestForm({
  onRequested,
  commissionOwedCents = 0,
  bankPayoutAvailable = false,
}: {
  onRequested: () => void;
  /** Phase 1b — outstanding Cash App / Zelle commission, shown as a heads-up
   *  that it's settled from this payout. Positive = merchant owes. */
  commissionOwedCents?: number;
  /** Phase 2 — show the "Bank (ACH)" option (store's Connect account is ACTIVE). */
  bankPayoutAvailable?: boolean;
}) {
  const [method, setMethod] = useState<Method>('CASH_APP');
  const [identifier, setIdentifier] = useState('');
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [result, setResult] = useState<WithdrawalResult | null>(null);

  async function submitWithdrawal(withPin: string) {
    const amountCents = Math.round(Number(amount) * 100);
    const destination =
      method === 'CASH_APP'
        ? { method, cashtag: identifier }
        : method === 'ZELLE'
          ? { method, contact: identifier }
          : { method: 'BANK' as const };
    const res = await api<WithdrawalResult>('/api/withdrawals', {
      method: 'POST',
      body: { amount: amountCents, currency: 'USD', destination, pin: withPin },
    });
    setResult(res);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setResult(null);

    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (method !== 'BANK' && !identifier.trim()) {
      setError(method === 'CASH_APP' ? 'Enter your $Cashtag.' : 'Enter your Zelle email or phone.');
      return;
    }

    setSubmitting(true);
    try {
      await submitWithdrawal(pin);
      setSuccess(true);
      setAmount('');
      setPin('');
      onRequested();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PIN_NOT_SET') {
        setNeedsPinSetup(true);
      } else {
        setError(
          err instanceof ApiError
            ? (ERROR_MESSAGES[err.code] ?? err.message)
            : 'Network error. Try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onSetPin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{4,6}$/.test(newPin)) {
      setError('PIN must be 4 to 6 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setError('PIN confirmation does not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api('/api/auth/withdrawal-pin', { method: 'POST', body: { newPin } });
      await submitWithdrawal(newPin);
      setNeedsPinSetup(false);
      setSuccess(true);
      setAmount('');
      setPin('');
      setNewPin('');
      setConfirmPin('');
      onRequested();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (needsPinSetup) {
    return (
      <form onSubmit={onSetPin} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Set a withdrawal PIN to confirm this and future withdrawal requests.
        </p>
        <Field label="New PIN (4–6 digits)" htmlFor="newPin">
          <input
            id="newPin"
            type="password"
            inputMode="numeric"
            className={inputClass}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
          />
        </Field>
        <Field label="Confirm PIN" htmlFor="confirmPin">
          <input
            id="confirmPin"
            type="password"
            inputMode="numeric"
            className={inputClass}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Setting PIN…' : 'Set PIN & Request Withdrawal'}
        </Button>
      </form>
    );
  }

  const methods: Method[] = bankPayoutAvailable
    ? ['CASH_APP', 'ZELLE', 'BANK']
    : ['CASH_APP', 'ZELLE'];
  const methodLabel: Record<Method, string> = {
    CASH_APP: 'Cash App',
    ZELLE: 'Zelle',
    BANK: 'Bank (ACH)',
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex gap-2">
        {methods.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium ${
              method === m
                ? 'border-primary bg-secondary text-foreground'
                : 'border-border text-muted-foreground'
            }`}
          >
            {methodLabel[m]}
          </button>
        ))}
      </div>

      {method === 'BANK' ? (
        <p className="rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          Paid to the bank account on your connected Stripe account. Stripe deposits it on its
          standard ACH schedule (usually 2 business days).
        </p>
      ) : (
        <Field
          label={method === 'CASH_APP' ? '$Cashtag' : 'Zelle email or phone'}
          htmlFor="identifier"
        >
          <input
            id="identifier"
            className={inputClass}
            placeholder={method === 'CASH_APP' ? '$yourshop' : 'you@example.com'}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
        </Field>
      )}

      <Field label="Amount (USD)" htmlFor="amount">
        <input
          id="amount"
          type="number"
          min="0.01"
          step="0.01"
          className={inputClass}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>

      {commissionOwedCents > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          You enter the amount you want to receive. Up to{' '}
          <strong>${(commissionOwedCents / 100).toFixed(2)}</strong> of Vendylio commission owed on
          your Cash App / Zelle orders is settled from this payout on top of that.
        </p>
      )}

      <Field label="Withdrawal PIN" htmlFor="pin">
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          className={inputClass}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
      </Field>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {success && (
        <div className="text-sm text-green-600">
          <p>Withdrawal requested.</p>
          {result && result.commissionSettledCents !== 0 && (
            <p className="text-xs text-muted-foreground">
              You&apos;ll receive ${(result.netAmount / 100).toFixed(2)}. $
              {(result.commissionSettledCents / 100).toFixed(2)} of Vendylio commission was settled
              from this payout.
            </p>
          )}
        </div>
      )}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? 'Requesting…' : 'Request Withdrawal'}
      </Button>
    </form>
  );
}
