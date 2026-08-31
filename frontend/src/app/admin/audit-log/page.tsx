'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import {
  auditFilterGroups,
  describeAuditEntry,
  relativeTime,
  toneClass,
  type AuditEntry,
} from '@/lib/adminAuditLabels';

const FILTER_GROUPS = auditFilterGroups();

function EntryCard({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const d = describeAuditEntry(entry);
  const when = new Date(entry.createdAt);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${toneClass(
            d.tone,
          )}`}
        >
          <Icon i={d.icon} size={17} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm text-foreground">
              <span className="font-semibold">{d.actorName}</span> {d.phrase}
            </p>
            <time
              dateTime={entry.createdAt}
              title={when.toLocaleString()}
              className="flex-shrink-0 text-xs text-muted-foreground"
            >
              {relativeTime(entry.createdAt)}
            </time>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="rounded bg-secondary px-1.5 py-0.5 font-medium">{d.label}</span>
            {d.target?.sub && <span className="truncate">{d.target.sub}</span>}
          </div>

          {d.facts.length > 0 && (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              {d.facts.map((f, i) => (
                <div key={i} className="contents">
                  <dt className="text-muted-foreground">{f.label}</dt>
                  <dd className="break-words font-medium text-foreground">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Icon i={open ? 'chevron-up' : 'chevron-down'} size={13} />
            {open ? 'Hide technical details' : 'Technical details'}
          </button>

          {open && (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-secondary p-3 text-[11px]">
              <dt className="text-muted-foreground">Event key</dt>
              <dd className="font-mono text-foreground">{entry.action}</dd>
              <dt className="text-muted-foreground">Actor ID</dt>
              <dd className="font-mono break-all text-foreground">{entry.actorId}</dd>
              {entry.targetType && (
                <>
                  <dt className="text-muted-foreground">Target</dt>
                  <dd className="font-mono break-all text-foreground">
                    {entry.targetType} · {entry.targetId ?? '—'}
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">When</dt>
              <dd className="text-foreground">{when.toLocaleString()}</dd>
              {entry.ip && (
                <>
                  <dt className="text-muted-foreground">IP</dt>
                  <dd className="font-mono text-foreground">{entry.ip}</dd>
                </>
              )}
              {entry.userAgent && (
                <>
                  <dt className="text-muted-foreground">User agent</dt>
                  <dd className="break-words text-foreground">{entry.userAgent}</dd>
                </>
              )}
              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <>
                  <dt className="text-muted-foreground">Raw data</dt>
                  <dd>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-foreground">
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  </dd>
                </>
              )}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
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
        Activity log
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Every change made from the back office — who did it, and when.
      </p>

      <div className="mb-6 flex items-center gap-2">
        <label htmlFor="audit-filter" className="text-sm text-muted-foreground">
          Show
        </label>
        <select
          id="audit-filter"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          <option value="">All events</option>
          {FILTER_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && entries === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!error && entries !== null && entries.length === 0 && (
        <div className="py-16 text-center">
          <Icon i="clipboard" size={32} className="mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">Nothing here yet for this filter.</p>
        </div>
      )}
      {entries && entries.length > 0 && (
        <>
          <div className="space-y-2">
            {entries.map((e) => (
              <EntryCard key={e.id} entry={e} />
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
