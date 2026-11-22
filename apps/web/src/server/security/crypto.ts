import 'server-only';
import { createSecretBox, type SecretBox } from '@revo/shared/secret-box';
import { env } from '../config/env';

// AES-256-GCM for secrets stored in the database (GitHub user tokens, the
// accounts' Anthropic API keys). The scheme lives in @revo/shared/secret-box so
// the worker reads the same values: it needs the same TOKEN_ENCRYPTION_KEY
// (or AUTH_SECRET when that is not set).

let box: SecretBox | null = null;

/** Created on first use: a missing key fails the call that needs it, not the server start. */
function secretBox(): SecretBox {
  box ??= createSecretBox({ encryptionKey: env.TOKEN_ENCRYPTION_KEY, authSecret: env.AUTH_SECRET });
  return box;
}

export function encryptSecret(plain: string): string {
  return secretBox().encrypt(plain);
}

export function decryptSecret(payload: string): string {
  return secretBox().decrypt(payload);
}
