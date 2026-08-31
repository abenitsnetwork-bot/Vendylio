import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { signDoorDashJwt, getDoorDashJwt, __resetDoorDashJwtCache } from './doordash-jwt';

const CREDS = {
  developerId: 'dev-123',
  keyId: 'key-456',
  signingSecret: Buffer.from('super-secret-bytes').toString('base64'),
};

function decode(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('signDoorDashJwt', () => {
  it('produces a DD-JWT-V1 header + doordash audience + kid/iss claims', () => {
    const token = signDoorDashJwt(CREDS, 300);
    const [h, p, sig] = token.split('.');
    expect(decode(h!)).toEqual({ alg: 'HS256', typ: 'JWT', 'dd-ver': 'DD-JWT-V1' });
    const payload = decode(p!);
    expect(payload).toMatchObject({ aud: 'doordash', iss: 'dev-123', kid: 'key-456' });
    expect(payload.exp - payload.iat).toBe(300);
    expect(sig).toBeTruthy();
  });

  it('signs with the base64-decoded secret bytes (HMAC-SHA256, base64url output)', () => {
    const token = signDoorDashJwt(CREDS, 300);
    const [h, p, sig] = token.split('.');
    const expected = createHmac('sha256', Buffer.from(CREDS.signingSecret, 'base64'))
      .update(`${h}.${p}`)
      .digest('base64url');
    expect(sig).toBe(expected);
  });
});

describe('getDoorDashJwt cache', () => {
  beforeEach(() => {
    __resetDoorDashJwtCache();
    vi.stubEnv('DOORDASH_DEVELOPER_ID', CREDS.developerId);
    vi.stubEnv('DOORDASH_KEY_ID', CREDS.keyId);
    vi.stubEnv('DOORDASH_SIGNING_SECRET', CREDS.signingSecret);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetDoorDashJwtCache();
  });

  it('reuses a cached token within the window', () => {
    expect(getDoorDashJwt()).toBe(getDoorDashJwt());
  });

  it('throws when credentials are missing', () => {
    vi.unstubAllEnvs();
    __resetDoorDashJwtCache();
    expect(() => getDoorDashJwt()).toThrow(/not configured/i);
  });
});
