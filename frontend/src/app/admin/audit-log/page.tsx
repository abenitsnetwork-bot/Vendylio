'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';

interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export default function AdminAuditLogPage() {
  const [action, setAction] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((filterAction: string) => {
    setEntries(null);
    setCursor(null);
    setError(null);
    const qs = filterAction ? `?action=${encodeURIComponent(filterAction)}` : '';
    api<{ items: AuditEntry[]; nextCursor: string | null }>(`/api/admin/audit-log${qs}`)
      .then((res) => {
        setEntries(res.items);
        setCursor(res.nextCursor);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the audit log.'),
      );
  }, []);

  useEffect(() => {
    load(action);
  }, [action, load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ cursor });
      if (action) qs.set('action', action);
      const res = await api<{ items: AuditEntry[]; nextCursor: string | null }>(
        `/api/admin/audit-log?${qs.toString()}`,
      );
      setEntries((prev) => [...(prev ?? []), ...res.items]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more entries.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <h1
        className="mb-2 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
      >
        Audit Log
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Every back-office mutation — who did what, when.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(action);
        }}
        className="mb-6 flex gap-3"
      >
        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Filter by action (e.g. user.role_change)"
          className="min-w-64 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        />
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Filter
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && entries === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!error && entries !== null && entries.length === 0 && (
        <div className="py-16 text-center">
          <Icon i="clipboard" size={32} className="mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">No matching audit entries.</p>
        </div>
      )}
      {entries && entries.length > 0 && (
        <>
          <div className="space-y-2">
            {entries.map((e) => (
              <div key={e.id} className="rounded-lg border border-border bg-card p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{e.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Actor <span className="font-mono">{e.actorId}</span>
                  {e.targetType && (
                    <>
                      {' '}
                      → {e.targetType} <span className="font-mono">{e.targetId}</span>
                    </>
                  )}
                </p>
                {e.metadata && (
                  <pre className="mt-2 overflow-x-auto rounded bg-secondary p-2 text-xs text-muted-foreground">
                    {JSON.stringify(e.metadata, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
          {cursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-6 w-full rounded-lg border border-border bg-card py-3 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
