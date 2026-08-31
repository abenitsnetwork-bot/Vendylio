// Human-readable rendering of AdminAction rows for the /admin/audit-log page.
//
// The audit log stores machine keys ("user.role_change") + a free-form
// `metadata` JSON blob. This module turns one row into a plain-English
// sentence, a category, an icon and a tidy list of "before / after" facts
// so the page never has to show raw JSON to a human.
//
// Adding a new audited action: add one ACTION_META entry here (and, if it
// carries new metadata keys, a META_KEY_LABELS entry). Unknown actions
// still render — they fall back to a title-cased version of the key.

import type { IconName } from '@/components/ui/Icon';

export type AuditTone = 'neutral' | 'positive' | 'warning' | 'danger';

export interface AuditActor {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

export interface AuditTarget {
  /** Display name — a person's name/email, a store name, etc. */
  label: string;
  /** Secondary line — an email under a name, a `/s/slug` under a store. */
  sub: string | null;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  actor?: AuditActor | null;
  target?: AuditTarget | null;
}

interface ActionMeta {
  /** Short label for the timeline chip and the filter dropdown. */
  label: string;
  icon: IconName;
  tone: AuditTone;
  /** Group heading in the filter dropdown. */
  group: string;
  /**
   * Verb phrase completing "{Actor} …". `target` is the resolved target
   * name (or a generic noun when we couldn't resolve it).
   */
  phrase: (ctx: { target: string; meta: Record<string, unknown> }) => string;
}

const pct = (bp: unknown): string =>
  typeof bp === 'number' ? `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%` : String(bp ?? '—');

export const ACTION_META: Record<string, ActionMeta> = {
  'user.role_change': {
    label: 'Role changed',
    icon: 'shield',
    tone: 'warning',
    group: 'People',
    phrase: ({ target, meta }) =>
      `changed ${target}'s role from ${meta.from ?? '—'} to ${meta.to ?? '—'}`,
  },
  'user.suspend': {
    label: 'Account suspended',
    icon: 'lock',
    tone: 'danger',
    group: 'People',
    phrase: ({ target, meta }) =>
      `suspended ${target}${meta.reason ? ` — ${String(meta.reason)}` : ''}`,
  },
  'user.restore': {
    label: 'Account restored',
    icon: 'check-circle',
    tone: 'positive',
    group: 'People',
    phrase: ({ target }) => `restored ${target}'s account`,
  },
  'user.resend_verification': {
    label: 'Verification email resent',
    icon: 'mail',
    tone: 'neutral',
    group: 'People',
    phrase: ({ target }) => `resent the verification email to ${target}`,
  },
  'user.temp_password': {
    label: 'Temporary password issued',
    icon: 'key',
    tone: 'warning',
    group: 'People',
    phrase: ({ target }) => `issued a one-time temporary password for ${target}`,
  },
  'store.publish': {
    label: 'Store published',
    icon: 'rocket',
    tone: 'positive',
    group: 'Stores',
    phrase: ({ target }) => `published ${target}`,
  },
  'store.unpublish': {
    label: 'Store taken offline',
    icon: 'eye-off',
    tone: 'warning',
    group: 'Stores',
    phrase: ({ target }) => `took ${target} offline`,
  },
  'store.delete': {
    label: 'Store deleted',
    icon: 'trash',
    tone: 'danger',
    group: 'Stores',
    phrase: ({ target, meta }) => `deleted the store ${meta.name ? String(meta.name) : target}`,
  },
  'withdrawal.complete': {
    label: 'Payout marked as sent',
    icon: 'dollar-sign',
    tone: 'positive',
    group: 'Payouts',
    phrase: ({ meta }) => `marked a ${money(meta.amount, meta.currency)} payout as sent`,
  },
  'withdrawal.cancel': {
    label: 'Withdrawal cancelled',
    icon: 'x',
    tone: 'danger',
    group: 'Payouts',
    phrase: ({ meta }) =>
      `cancelled a ${money(meta.amount, meta.currency)} withdrawal${
        meta.reason ? ` — ${String(meta.reason)}` : ''
      }`,
  },
  'testimonial.create': {
    label: 'Testimonial added',
    icon: 'plus',
    tone: 'neutral',
    group: 'Site content',
    phrase: ({ meta }) => `added a testimonial${meta.name ? ` from ${String(meta.name)}` : ''}`,
  },
  'testimonial.update': {
    label: 'Testimonial edited',
    icon: 'star',
    tone: 'neutral',
    group: 'Site content',
    phrase: () => `edited a testimonial`,
  },
  'testimonial.delete': {
    label: 'Testimonial removed',
    icon: 'trash',
    tone: 'danger',
    group: 'Site content',
    phrase: ({ meta }) => `removed the testimonial${meta.name ? ` from ${String(meta.name)}` : ''}`,
  },
  'site_image.update': {
    label: 'Landing image updated',
    icon: 'image',
    tone: 'neutral',
    group: 'Site content',
    phrase: ({ meta }) => `updated the "${String(meta.key ?? 'landing')}" landing image`,
  },
  'site_image.clear': {
    label: 'Landing image cleared',
    icon: 'image',
    tone: 'warning',
    group: 'Site content',
    phrase: () => `cleared a landing image`,
  },
  'settings.commission_rate_change': {
    label: 'Commission rate changed',
    icon: 'settings',
    tone: 'warning',
    group: 'Platform settings',
    phrase: ({ meta }) =>
      `changed the commission rate from ${pct(meta.previousCommissionRateBp)} to ${pct(
        meta.newCommissionRateBp,
      )}`,
  },
};

function money(amount: unknown, currency: unknown): string {
  if (typeof amount !== 'number') return 'a';
  const code = typeof currency === 'string' ? currency.toUpperCase() : 'USD';
  if (code === 'USD') return `$${(amount / 100).toFixed(2)}`;
  return `${amount} ${code}`;
}

/** Friendly labels for the "details" facts under each entry. */
const META_KEY_LABELS: Record<string, string> = {
  from: 'Before',
  to: 'After',
  reason: 'Reason',
  note: 'Note',
  email: 'Email',
  name: 'Name',
  slug: 'Store link',
  url: 'Image URL',
  key: 'Slot',
  previousStatus: 'Previous status',
  amount: 'Amount',
  currency: 'Currency',
  withdrawalId: 'Withdrawal ID',
  previousCommissionRateBp: 'Previous rate',
  newCommissionRateBp: 'New rate',
  previousCommissionRateBpPro: 'Previous Pro rate',
  newCommissionRateBpPro: 'New Pro rate',
  detail: 'Detail',
  location: 'Location',
  quote: 'Quote',
  visible: 'Visible',
};

/** Keys we already fold into the headline sentence — hide them from the facts. */
const REDUNDANT_KEYS: Record<string, Set<string>> = {
  'user.role_change': new Set(['from', 'to']),
  'user.suspend': new Set(['reason']),
  'withdrawal.complete': new Set(['amount', 'currency']),
  'withdrawal.cancel': new Set(['amount', 'currency', 'reason']),
  'settings.commission_rate_change': new Set(['previousCommissionRateBp', 'newCommissionRateBp']),
  'testimonial.create': new Set(['name']),
  'testimonial.delete': new Set(['name']),
  'store.delete': new Set(['name']),
  'site_image.update': new Set(['key']),
};

function titleCase(key: string): string {
  return key
    .replace(/[._]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key.endsWith('Bp') || key.endsWith('BpPro')) return pct(value);
  if (key === 'amount' && typeof value === 'number') return `$${(value / 100).toFixed(2)}`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export interface DescribedEntry {
  label: string;
  icon: IconName;
  tone: AuditTone;
  group: string;
  actorName: string;
  actorSub: string | null;
  /** Verb phrase without the actor: "changed Jean's role…". */
  phrase: string;
  /** Full sentence: "Marie changed Jean's role…". */
  sentence: string;
  target: AuditTarget | null;
  facts: { label: string; value: string }[];
}

export function describeAuditEntry(entry: AuditEntry): DescribedEntry {
  const meta = ACTION_META[entry.action];
  const rawMeta = entry.metadata ?? {};

  const actorName = entry.actor?.name || entry.actor?.email || 'An admin';
  const actorSub = entry.actor?.name ? entry.actor.email : null;

  const targetName =
    entry.target?.label || (entry.targetType ? `a ${entry.targetType.toLowerCase()}` : 'something');

  const phrase = meta
    ? meta.phrase({ target: targetName, meta: rawMeta })
    : `${titleCase(entry.action).toLowerCase()}${entry.target ? ` — ${entry.target.label}` : ''}`;

  const redundant = REDUNDANT_KEYS[entry.action] ?? new Set<string>();
  const facts = Object.entries(rawMeta)
    .filter(([k, v]) => !redundant.has(k) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => ({
      label: META_KEY_LABELS[k] ?? titleCase(k),
      value: formatValue(k, v),
    }));

  return {
    label: meta?.label ?? titleCase(entry.action),
    icon: meta?.icon ?? 'clipboard',
    tone: meta?.tone ?? 'neutral',
    group: meta?.group ?? 'Other',
    actorName,
    actorSub,
    phrase: `${phrase}.`,
    sentence: `${actorName} ${phrase}.`,
    target: entry.target ?? null,
    facts,
  };
}

/** Options for the filter dropdown, grouped by domain. */
export function auditFilterGroups(): {
  group: string;
  options: { value: string; label: string }[];
}[] {
  const byGroup = new Map<string, { value: string; label: string }[]>();
  for (const [value, m] of Object.entries(ACTION_META)) {
    const list = byGroup.get(m.group) ?? [];
    list.push({ value, label: m.label });
    byGroup.set(m.group, list);
  }
  return [...byGroup.entries()].map(([group, options]) => ({
    group,
    options: options.sort((a, b) => a.label.localeCompare(b.label)),
  }));
}

const TONE_CLASS: Record<AuditTone, string> = {
  neutral: 'bg-secondary text-muted-foreground',
  positive: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  danger: 'bg-red-100 text-red-700',
};

export function toneClass(tone: AuditTone): string {
  return TONE_CLASS[tone];
}

/** "3 min ago" / "2 days ago" — coarse, good enough for an audit timeline. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mo ago`;
  return `${Math.round(months / 12)} yr ago`;
}
