// Lazy-initialized Anthropic client — mirrors the Cloudinary lazy-init
// pattern (see upload/cloudinary-client.ts): `new Anthropic({apiKey: ''})`
// doesn't throw synchronously on a missing key, it would only fail at
// request time with an opaque error. Gating on ANTHROPIC_API_KEY up front
// lets the route return a clean 503 AI_NOT_CONFIGURED instead.
//
// Also avoids reading `process.env` at module top-level, so tests that
// mutate the env (vi.stubEnv) aren't locked into a stale value from import
// time.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Thrown by `getAnthropicClient()` when `ANTHROPIC_API_KEY` is missing or
 * empty. Callers catch this `instanceof` and translate to 503
 * `{ error: 'AI_NOT_CONFIGURED' }`.
 */
export class AiNotConfiguredError extends Error {
  constructor() {
    super('AI not configured (ANTHROPIC_API_KEY missing or empty)');
    this.name = 'AiNotConfiguredError';
  }
}

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (_client) return _client;

  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) throw new AiNotConfiguredError();

  _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * Test-only escape hatch — clears the cached client so a test can mutate
 * `process.env.ANTHROPIC_API_KEY` and re-trigger lazy init. Never call this
 * from application code.
 *
 * @internal
 */
export function __resetAnthropicSingleton(): void {
  _client = null;
}
