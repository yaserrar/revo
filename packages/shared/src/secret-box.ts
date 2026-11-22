/**
 * AES-256-GCM for secrets stored in the database (GitHub user tokens, the
 * accounts' Anthropic API keys). Node only: imported as
 * `@revo/shared/secret-box`, never from the browser-safe index.
 *
 * Format: v1.<iv>.<tag>.<ciphertext>, base64url parts. The key is derived from
 * TOKEN_ENCRYPTION_KEY, or from AUTH_SECRET when it is not set, so web and
 * worker must be given the same values to read each other's secrets.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type SecretKeyMaterial = {
  /** TOKEN_ENCRYPTION_KEY. Wins over the AUTH_SECRET derivation. */
  encryptionKey?: string | undefined;
  /** AUTH_SECRET, used only to derive the key when TOKEN_ENCRYPTION_KEY is not set. */
  authSecret?: string | undefined;
};

export type SecretBox = {
  encrypt(plain: string): string;
  /** Throws on a wrong key, a tampered payload or an unknown format. */
  decrypt(payload: string): string;
};

export class SecretKeyMissingError extends Error {
  constructor() {
    super('Set TOKEN_ENCRYPTION_KEY or AUTH_SECRET to store secrets');
    this.name = 'SecretKeyMissingError';
  }
}

export function hasSecretKeyMaterial(material: SecretKeyMaterial): boolean {
  return Boolean(material.encryptionKey || material.authSecret);
}

function deriveKey(material: SecretKeyMaterial): Buffer {
  const source = material.encryptionKey || material.authSecret;
  if (!source) throw new SecretKeyMissingError();
  return createHash('sha256').update(`revo-token-key:${source}`).digest();
}

/** A box bound to one key. Throws SecretKeyMissingError when neither value is set. */
export function createSecretBox(material: SecretKeyMaterial): SecretBox {
  const key = deriveKey(material);
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv, cipher.getAuthTag(), data]
        .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
        .join('.');
    },
    decrypt(payload) {
      const [version, iv, tag, data] = payload.split('.');
      if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported secret format');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}

/** Last 4 characters of an API key, for display ("sk-ant-…abcd"). Never more. */
export function secretHint(secret: string): string {
  return secret.trim().slice(-4);
}
