import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';

/** What Anthropic said about a key: usable, refused, or no answer (try again later). */
export type KeyCheck = 'valid' | 'refused' | 'unavailable';

/**
 * Checks an account's Anthropic API key with one cheap call (list one model):
 * no tokens are spent and no code is sent. Never logs the key. Tests replace
 * this module (vi.mock) and the browser checks point ANTHROPIC_BASE_URL at the
 * mock GitHub's stand-in, so no test ever reaches Anthropic.
 */
export async function checkAnthropicKey(apiKey: string): Promise<KeyCheck> {
  const client = new Anthropic({
    apiKey,
    baseURL: env.ANTHROPIC_BASE_URL,
    maxRetries: 1,
    timeout: 10_000,
  });
  try {
    await client.models.list({ limit: 1 });
    return 'valid';
  } catch (err) {
    // 401: unknown or revoked key; 403: the key may not use the API (e.g. a disabled workspace).
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
      return 'refused';
    // Rate limits, outages and network errors say nothing about the key.
    return 'unavailable';
  }
}
