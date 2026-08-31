import 'server-only';
import { log } from '@/lib/server/observability/log';

// Bot protection for the auth entry points (login / signup / forgot-password),
// backed by hCaptcha. INERT when HCAPTCHA_SECRET is unset — every form works
// exactly as before, which is what local dev and this headless starter want
// out of the box. The verify token is a one-time value from the browser
// widget; it is NEVER logged.
//
// Fail policy: a hard `success:false` from hCaptcha is always a rejection. A
// network error / timeout talking to hCaptcha is a rejection too (fail
// closed) UNLESS HCAPTCHA_FAIL_OPEN=1 — set that if an hCaptcha outage
// locking everyone out is worse for you than a brief window of no bot
// protection.

const VERIFY_URL = 'https://api.hcaptcha.com/siteverify';
const TIMEOUT_MS = 5000;

export interface CaptchaResult {
  ok: boolean;
  reason?: 'DISABLED' | 'MISSING_TOKEN' | 'REJECTED' | 'UNAVAILABLE';
}

let warnedDisabled = false;

export function captchaConfigured(): boolean {
  return Boolean(process.env.HCAPTCHA_SECRET);
}

export async function verifyCaptcha(
  token: string | undefined | null,
  remoteIp?: string | null,
): Promise<CaptchaResult> {
  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      log.warn('hCaptcha disabled (HCAPTCHA_SECRET unset) — auth forms are not bot-protected');
    }
    return { ok: true, reason: 'DISABLED' };
  }

  if (!token) return { ok: false, reason: 'MISSING_TOKEN' };

  const failOpen = process.env.HCAPTCHA_FAIL_OPEN === '1';
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn('hCaptcha siteverify HTTP error', { status: res.status });
      return failOpen ? { ok: true, reason: 'UNAVAILABLE' } : { ok: false, reason: 'UNAVAILABLE' };
    }
    const data = (await res.json()) as { success?: boolean };
    if (data.success === true) return { ok: true };
    return { ok: false, reason: 'REJECTED' };
  } catch (err) {
    log.warn('hCaptcha siteverify unreachable', {
      error: err instanceof Error ? err.message : 'unknown',
      failOpen,
    });
    return failOpen ? { ok: true, reason: 'UNAVAILABLE' } : { ok: false, reason: 'UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
  }
}

// Shared 400 payload so all three routes speak the same error code.
export const CAPTCHA_FAILED = {
  error: 'CAPTCHA_FAILED',
  message: 'Captcha verification failed. Please try again.',
} as const;
