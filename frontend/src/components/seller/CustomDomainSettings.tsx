'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { usePlan } from '@/lib/usePlan';
import { Icon } from '@/components/ui/Icon';
import { ProUpgradeCard } from '@/components/seller/ProUpgradeCard';

interface DnsRecord {
  type: 'A' | 'CNAME' | 'TXT';
  name: string;
  value: string;
}

interface DomainStatus {
  customDomain: string | null;
  status: 'NONE' | 'PENDING' | 'ACTIVE' | 'ERROR';
  verified: boolean;
  misconfigured: boolean;
  records: DnsRecord[];
}

export function CustomDomainSettings({ storeSlug }: { storeSlug: string | null }) {
  const { isPro, loading: planLoading } = usePlan();
  const [data, setData] = useState<DomainStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api<DomainStatus>('/api/stores/domain')
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && err.code === 'DOMAIN_NOT_CONFIGURED') {
          setUnavailable(true);
          return;
        }
        if (err instanceof ApiError && err.code === 'PLAN_UPGRADE_REQUIRED') return;
        setError(err instanceof ApiError ? err.message : 'Could not load domain settings.');
      });
  }, []);

  useEffect(() => {
    if (planLoading || !isPro) return;
    load();
  }, [planLoading, isPro, load]);

  // Poll while pending.
  useEffect(() => {
    if (data?.status !== 'PENDING') return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [data?.status, load]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<DomainStatus>('/api/stores/domain', {
        method: 'POST',
        body: { domain: input.trim() },
      });
      setData(res);
      setInput('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect the domain.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (
      !confirm('Disconnect this domain? Your storefront stays available at its vendylio.com link.')
    )
      return;
    setBusy(true);
    try {
      await api('/api/stores/domain', { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  if (planLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!isPro) {
    return (
      <ProUpgradeCard title="Custom domain is a Pro feature">
        Serve your storefront on your own domain (shop.yourbrand.com) instead of a vendylio.com
        link.
      </ProUpgradeCard>
    );
  }

  if (unavailable) {
    return (
      <div className="rounded-xl border border-border bg-secondary/40 p-6 text-sm text-muted-foreground">
        Custom domains aren&apos;t available on this deployment yet. Check back soon.
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="font-headings text-lg font-bold text-foreground">Custom domain</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Point a domain you own at your storefront.
          {storeSlug && (
            <>
              {' '}
              Your default link stays{' '}
              <span className="font-medium text-foreground">/s/{storeSlug}</span>.
            </>
          )}
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && data.status === 'NONE' && (
        <form onSubmit={connect} className="flex flex-col gap-3 sm:flex-row">
          <input
            required
            placeholder="shop.yourbrand.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
          >
            {busy ? 'Connecting…' : 'Connect domain'}
          </button>
        </form>
      )}

      {data && data.status !== 'NONE' && (
        <div className="rounded-xl border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">{data.customDomain}</p>
              <p className="text-xs">
                {data.status === 'ACTIVE' ? (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <Icon i="check-circle" size={13} /> Live
                  </span>
                ) : (
                  <span className="text-amber-700">Waiting for DNS — verifying automatically…</span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy}
              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>

          {data.status !== 'ACTIVE' && data.records.length > 0 && (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                Add these records at your DNS provider. Verification runs on its own — this can take
                a few minutes.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Type</th>
                      <th className="py-1 pr-3">Name</th>
                      <th className="py-1">Value</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {data.records.map((r, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-1 pr-3">{r.type}</td>
                        <td className="py-1 pr-3 break-all">{r.name}</td>
                        <td className="py-1 break-all">{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={load} className="mt-3 text-xs font-medium text-accent">
                Check now
              </button>
            </>
          )}

          {data.status === 'ACTIVE' && (
            <a
              href={`https://${data.customDomain}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-accent"
            >
              Open {data.customDomain} ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
