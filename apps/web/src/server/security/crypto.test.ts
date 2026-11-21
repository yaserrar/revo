import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto';

describe('token encryption', () => {
  it('round-trips and never stores the plain value', () => {
    const enc = encryptSecret('ghu_secret_token_value');
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain('ghu_secret_token_value');
    expect(decryptSecret(enc)).toBe('ghu_secret_token_value');
  });

  it('uses a fresh IV each time', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects tampered payloads', () => {
    const [v, iv, tag, data] = encryptSecret('value').split('.');
    const flipped = data!.slice(0, -1) + (data!.endsWith('A') ? 'B' : 'A');
    expect(() => decryptSecret([v, iv, tag, flipped].join('.'))).toThrow();
    expect(() => decryptSecret('nope')).toThrow(/format/);
  });
});
