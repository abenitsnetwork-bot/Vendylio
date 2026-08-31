import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/server/observability/log', () => ({ log: { warn, info: vi.fn(), error: vi.fn() } }));

import { verifyCaptcha, captchaConfigured } from './captcha';

const OLD_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.HCAPTCHA_SECRET;
  delete process.env.HCAPTCHA_FAIL_OPEN;
});
afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

describe('verifyCaptcha — disabled', () => {
  it('is a no-op that passes when HCAPTCHA_SECRET is unset', async () => {
    expect(captchaConfigured()).toBe(false);
    const r = await verifyCaptcha(undefined);
    expect(r).toEqual({ ok: true, reason: 'DISABLED' });
  });
});

describe('verifyCaptcha — enabled', () => {
  beforeEach(() => {
    process.env.HCAPTCHA_SECRET = 'sk_test';
  });

  it('rejects a missing token without calling hCaptcha', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await verifyCaptcha('');
    expect(r).toEqual({ ok: false, reason: 'MISSING_TOKEN' });
    expect(f).not.toHaveBeenCalled();
  });

  it('passes on success:true', async () => {
    stubFetch(() => new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(await verifyCaptcha('tok')).toEqual({ ok: true });
  });

  it('rejects on success:false', async () => {
    stubFetch(() => new Response(JSON.stringify({ success: false }), { status: 200 }));
    expect(await verifyCaptcha('tok')).toEqual({ ok: false, reason: 'REJECTED' });
  });

  it('fails closed on a network error', async () => {
    stubFetch(() => {
      throw new Error('ECONNRESET');
    });
    expect(await verifyCaptcha('tok')).toEqual({ ok: false, reason: 'UNAVAILABLE' });
  });

  it('fails open on a network error when HCAPTCHA_FAIL_OPEN=1', async () => {
    process.env.HCAPTCHA_FAIL_OPEN = '1';
    stubFetch(() => {
      throw new Error('timeout');
    });
    expect(await verifyCaptcha('tok')).toEqual({ ok: true, reason: 'UNAVAILABLE' });
  });

  it('never passes the token to the logger', async () => {
    stubFetch(() => {
      throw new Error('boom');
    });
    await verifyCaptcha('super-secret-token-value');
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('super-secret-token-value');
    }
  });
});
