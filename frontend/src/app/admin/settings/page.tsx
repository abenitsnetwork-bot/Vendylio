'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

interface CommissionSettings {
  commissionRateBp: number;
  commissionRateBpPro: number | null;
}

// The API stores basis points (600 = 6%); the form works in plain percent
// for a human to read/type.
function bpToPercent(bp: number): string {
  return (bp / 100).toString();
}

function percentToBp(percent: string): number {
  const n = Number(percent);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<CommissionSettings | null>(null);
  const [rate, setRate] = useState('0');
  const [proRate, setProRate] = useState('');
  const [proEnabled, setProEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<CommissionSettings>('/api/admin/settings')
      .then((res) => {
        setSettings(res);
        setRate(bpToPercent(res.commissionRateBp));
        if (res.commissionRateBpPro !== null) {
          setProEnabled(true);
          setProRate(bpToPercent(res.commissionRateBpPro));
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load settings.'));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await api<CommissionSettings>('/api/admin/settings', {
        method: 'PATCH',
        body: {
          commissionRateBp: percentToBp(rate),
          commissionRateBpPro: proEnabled ? percentToBp(proRate) : null,
        },
      });
      setSettings(res);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <h1
        className="mb-2 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
      >
        Settings
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Platform-wide configuration. Changes take effect on the next order — nothing needs to
        redeploy.
      </p>

      {!settings && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {settings && (
        <Card className="max-w-lg p-8">
          <h2 className="mb-1 font-headings text-lg font-bold text-foreground">
            Marketplace commission
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            The cut Vendylio takes from every sale. Applies to both the manual-withdrawal flow
            (Stripe platform charges) and Stripe Connect destination charges.
          </p>

          <form onSubmit={onSubmit} className="space-y-5">
            <Field label="Standard commission (%)" htmlFor="rate">
              <input
                id="rate"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className={inputClass}
              />
            </Field>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={proEnabled}
                  onChange={(e) => setProEnabled(e.target.checked)}
                />
                Discounted rate for PRO stores
              </label>
              {proEnabled && (
                <div className="mt-3">
                  <Field label="PRO commission (%)" htmlFor="proRate">
                    <input
                      id="proRate"
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={proRate}
                      onChange={(e) => setProRate(e.target.value)}
                      className={inputClass}
                    />
                  </Field>
                </div>
              )}
              {!proEnabled && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  PRO stores pay the standard rate above.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-green-700">Saved.</p>}

            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
