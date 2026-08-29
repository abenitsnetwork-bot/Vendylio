// Best-effort *immediate* delivery of a verification code.
//
// The normal path — signup writes an `email.verification_code` outbox row,
// the `outbox-drain` cron (1 min) turns it into an EmailJob, the
// `email-queue-drain` cron (1 min) sends it — is fine for order emails but
// makes a person stare at a "check your inbox" screen for up to ~2 minutes.
//
// This runs from `after()` (post-response, so it adds zero latency to the
// signup request and never breaks enumeration-timing parity) and delivers
// the code in ~1-2 s. The outbox row stays the source of truth: we claim it
// (PENDING → SENT) before sending so the cron won't double-send; if anything
// throws BEFORE the job reaches the durable email queue, we release the row
// and the cron delivers it as the fallback. Never throws.
import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { getEmailQueue } from '@/lib/server/queues/email-queue-singleton';
import { log } from '@/lib/server/observability/log';
import { verificationEmail } from './email-templates';

export async function sendVerificationCodeNow(input: {
  to: string;
  code: string;
  expiresAt: Date;
}): Promise<void> {
  const queue = getEmailQueue();
  if (!queue) return; // email not configured — the cron path is the only path

  const claimWhere = {
    kind: 'email.verification_code',
    payload: { path: ['code'], equals: input.code },
  } as const;

  let claimed = false;
  let handedToQueue = false;
  try {
    const res = await prisma.outboxEvent.updateMany({
      where: { ...claimWhere, status: 'PENDING' },
      data: { status: 'SENT', sentAt: new Date() },
    });
    if (res.count === 0) return; // the cron already grabbed this row
    claimed = true;

    const tpl = verificationEmail({
      code: input.code,
      email: input.to,
      expiresAt: input.expiresAt.toISOString(),
    });
    await queue.enqueue({ to: input.to, subject: tpl.subject, html: tpl.html });
    handedToQueue = true; // from here on, the email queue owns delivery + retries
    await queue.drainOne();
  } catch (err) {
    log.warn('sendVerificationCodeNow: immediate send failed', {
      err: err instanceof Error ? err.message : String(err),
      handedToQueue,
    });
    // Only release the outbox row if the job never reached the durable queue —
    // otherwise `email-queue-drain` retries it and releasing would double-send.
    if (claimed && !handedToQueue) {
      await prisma.outboxEvent
        .updateMany({
          where: { ...claimWhere, status: 'SENT' },
          data: { status: 'PENDING', sentAt: null },
        })
        .catch(() => {});
    }
  }
}
