import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const enqueue = vi.fn();
const drainOne = vi.fn();
vi.mock('@/lib/server/queues/email-queue-singleton', () => ({
  getEmailQueue: vi.fn(() => ({ enqueue, drainOne })),
}));
vi.mock('./email-templates', () => ({
  verificationEmail: vi.fn(() => ({ subject: 'Verify your email', html: '<p>123</p>' })),
}));

import { getEmailQueue } from '@/lib/server/queues/email-queue-singleton';
import { sendVerificationCodeNow } from './send-verification-now';

const INPUT = {
  to: 'new@buyer.com',
  code: 'ABCD1234',
  expiresAt: new Date('2026-01-01T00:15:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEmailQueue).mockReturnValue({ enqueue, drainOne } as never);
  enqueue.mockResolvedValue('job-1');
  drainOne.mockResolvedValue(true);
  prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
});

describe('sendVerificationCodeNow', () => {
  it('no-ops when the email queue is not configured', async () => {
    vi.mocked(getEmailQueue).mockReturnValueOnce(null);
    await sendVerificationCodeNow(INPUT);
    expect(prismaMock.outboxEvent.updateMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('claims the outbox row (PENDING→SENT), enqueues and drains', async () => {
    await sendVerificationCodeNow(INPUT);

    const claim = prismaMock.outboxEvent.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(claim.where).toMatchObject({
      kind: 'email.verification_code',
      status: 'PENDING',
      payload: { path: ['code'], equals: 'ABCD1234' },
    });
    expect(claim.data).toMatchObject({ status: 'SENT' });

    expect(enqueue).toHaveBeenCalledWith({
      to: 'new@buyer.com',
      subject: 'Verify your email',
      html: '<p>123</p>',
    });
    expect(drainOne).toHaveBeenCalledTimes(1);
  });

  it('does nothing more when the cron already claimed the row (count 0)', async () => {
    prismaMock.outboxEvent.updateMany.mockResolvedValueOnce({ count: 0 } as never);
    await sendVerificationCodeNow(INPUT);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('releases the outbox row when enqueue throws (job never reached the queue)', async () => {
    enqueue.mockRejectedValueOnce(new Error('redis down'));
    await sendVerificationCodeNow(INPUT);

    // second updateMany call = the release
    const release = prismaMock.outboxEvent.updateMany.mock.calls[1]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(release.where).toMatchObject({ status: 'SENT' });
    expect(release.data).toMatchObject({ status: 'PENDING', sentAt: null });
  });

  it('does NOT release when drainOne throws (email queue owns delivery now)', async () => {
    drainOne.mockRejectedValueOnce(new Error('resend timeout'));
    await sendVerificationCodeNow(INPUT);
    // only the initial claim — no release
    expect(prismaMock.outboxEvent.updateMany).toHaveBeenCalledTimes(1);
  });

  it('never throws', async () => {
    prismaMock.outboxEvent.updateMany.mockRejectedValueOnce(new Error('db gone'));
    await expect(sendVerificationCodeNow(INPUT)).resolves.toBeUndefined();
  });
});
