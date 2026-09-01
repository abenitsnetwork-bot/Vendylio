import { describe, it, expect } from 'vitest';
import { ApiError } from '@/lib/api';
import { handleGateError, onUpgradeNeeded, type UpgradeDetail } from './upgradePrompt';

function listen(): { calls: UpgradeDetail[]; stop: () => void } {
  const calls: UpgradeDetail[] = [];
  const stop = onUpgradeNeeded((d) => calls.push(d));
  return { calls, stop };
}

describe('handleGateError', () => {
  it('recognises PLAN_UPGRADE_REQUIRED and notifies with the feature', () => {
    const l = listen();
    const err = new ApiError(402, 'This feature is available on the Pro plan.', {
      error: 'PLAN_UPGRADE_REQUIRED',
      feature: 'customDomain',
    });
    expect(handleGateError(err)).toBe(true);
    expect(l.calls[0]).toEqual({
      code: 'PLAN_UPGRADE_REQUIRED',
      feature: 'customDomain',
      message: 'This feature is available on the Pro plan.',
    });
    l.stop();
  });

  it('recognises AI_QUOTA_EXCEEDED and PAYMENT_METHOD_REQUIRED', () => {
    const l = listen();
    expect(handleGateError(new ApiError(402, 'q', { error: 'AI_QUOTA_EXCEEDED' }))).toBe(true);
    expect(handleGateError(new ApiError(402, 'c', { error: 'PAYMENT_METHOD_REQUIRED' }))).toBe(
      true,
    );
    expect(l.calls.map((c) => c.code)).toEqual(['AI_QUOTA_EXCEEDED', 'PAYMENT_METHOD_REQUIRED']);
    l.stop();
  });

  it('ignores other API errors and non-ApiError values', () => {
    const l = listen();
    expect(handleGateError(new ApiError(400, 'nope', { error: 'VALIDATION_FAILED' }))).toBe(false);
    expect(handleGateError(new Error('boom'))).toBe(false);
    expect(handleGateError(null)).toBe(false);
    expect(l.calls).toHaveLength(0);
    l.stop();
  });

  it('onUpgradeNeeded unsubscribe stops further calls', () => {
    const l = listen();
    l.stop();
    handleGateError(new ApiError(402, 'x', { error: 'PLAN_UPGRADE_REQUIRED' }));
    expect(l.calls).toHaveLength(0);
  });
});
