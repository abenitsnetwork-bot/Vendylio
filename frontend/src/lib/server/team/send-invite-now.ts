// Phase 4a — best-effort delivery of a team invitation email.
//
// Mirrors auth/send-verification-now.ts in spirit but simpler: there is no
// outbox row to reconcile (the TeamInvite row + the token IS the source of
// truth, and the route also returns the invite URL for a "copy link" UX).
// `EmailQueue.enqueue` already writes a durable EmailJob row + pushes the
// Redis work pointer, so the `email-queue-drain` cron (1 min) delivers it
// even if the immediate `drainOne()` here fails. Never throws.
import 'server-only';
import { getEmailQueue } from '@/lib/server/queues/email-queue-singleton';
import { log } from '@/lib/server/observability/log';

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendTeamInviteNow(input: {
  to: string;
  orgName: string;
  inviterEmail: string;
  role: 'ADMIN' | 'MEMBER';
  url: string;
}): Promise<void> {
  const queue = getEmailQueue();
  if (!queue) return;

  const org = htmlEscape(input.orgName);
  const inviter = htmlEscape(input.inviterEmail);
  const url = htmlEscape(input.url);
  const roleLabel = input.role === 'ADMIN' ? 'an admin' : 'a team member';

  const subject = `You've been invited to ${input.orgName} on Vendylio`;
  const html =
    `<p>Hi,</p>` +
    `<p><strong>${inviter}</strong> invited you to join <strong>${org}</strong> as ${roleLabel} on Vendylio.</p>` +
    `<p><a href="${url}">Accept the invitation</a></p>` +
    `<p>Or paste this link into your browser:<br>${url}</p>` +
    `<p>This invite expires in 7 days. If you weren't expecting it, you can ignore this email.</p>`;
  const text =
    `${input.inviterEmail} invited you to join ${input.orgName} as ${roleLabel} on Vendylio.\n\n` +
    `Accept: ${input.url}\n\nThis invite expires in 7 days.`;

  try {
    await queue.enqueue({ to: input.to, subject, html, text });
    await queue.drainOne();
  } catch (err) {
    log.warn('sendTeamInviteNow: immediate send failed (cron will retry)', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
