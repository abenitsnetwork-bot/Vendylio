import { describe, it, expect } from 'vitest';
import {
  auditFilterGroups,
  describeAuditEntry,
  relativeTime,
  type AuditEntry,
} from './adminAuditLabels';

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'a1',
    actorId: 'admin_1',
    action: 'user.role_change',
    targetType: 'User',
    targetId: 'u1',
    metadata: { from: 'USER', to: 'ADMIN' },
    ip: '127.0.0.1',
    userAgent: 'test',
    createdAt: new Date().toISOString(),
    actor: { id: 'admin_1', name: 'Marie', email: 'marie@x.com', role: 'SUPERADMIN' },
    target: { label: 'jane@shop.com', sub: null },
    ...overrides,
  };
}

describe('describeAuditEntry', () => {
  it('builds a plain-English sentence for a known action', () => {
    const d = describeAuditEntry(entry());
    expect(d.actorName).toBe('Marie');
    expect(d.sentence).toBe("Marie changed jane@shop.com's role from USER to ADMIN.");
    expect(d.label).toBe('Role changed');
    expect(d.group).toBe('People');
  });

  it('hides keys already folded into the sentence, keeps the rest as facts', () => {
    const d = describeAuditEntry(
      entry({
        action: 'withdrawal.cancel',
        targetType: 'Withdrawal',
        targetId: 'w1',
        target: null,
        metadata: { amount: 5000, currency: 'USD', reason: 'fraud', previousStatus: 'PENDING' },
      }),
    );
    expect(d.sentence).toBe('Marie cancelled a $50.00 withdrawal — fraud.');
    expect(d.facts.map((f) => f.label)).toEqual(['Previous status']);
    expect(d.facts[0]?.value).toBe('PENDING');
  });

  it('falls back gracefully for an unknown action', () => {
    const d = describeAuditEntry(
      entry({ action: 'widget.frobnicate', metadata: {}, target: null, targetType: null }),
    );
    expect(d.label).toBe('Widget Frobnicate');
    expect(d.icon).toBe('clipboard');
    expect(d.sentence.startsWith('Marie ')).toBe(true);
  });

  it('uses "An admin" when the actor could not be resolved', () => {
    const d = describeAuditEntry(entry({ actor: null }));
    expect(d.actorName).toBe('An admin');
  });

  it('formats booleans as Yes/No', () => {
    const d = describeAuditEntry(
      entry({
        action: 'store.publish',
        targetType: 'Store',
        targetId: 's1',
        target: { label: 'Shopizy', sub: '/s/shopizy' },
        metadata: { from: false, to: true },
      }),
    );
    const facts = Object.fromEntries(d.facts.map((f) => [f.label, f.value]));
    expect(facts.Before).toBe('No');
    expect(facts.After).toBe('Yes');
  });
});

describe('auditFilterGroups', () => {
  it('groups every known action under a heading', () => {
    const groups = auditFilterGroups();
    expect(groups.length).toBeGreaterThan(0);
    const headings = groups.map((g) => g.group);
    expect(headings).toContain('People');
    expect(headings).toContain('Payouts');
    for (const g of groups) expect(g.options.length).toBeGreaterThan(0);
  });
});

describe('relativeTime', () => {
  it('returns "just now" for a fresh timestamp', () => {
    expect(relativeTime(new Date().toISOString())).toBe('just now');
  });
  it('returns minutes for a few minutes ago', () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5 min ago');
  });
  it('returns "" for garbage input', () => {
    expect(relativeTime('not-a-date')).toBe('');
  });
});
