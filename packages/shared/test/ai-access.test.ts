import { describe, expect, it } from 'vitest';
import {
  accountKeyRefusedText,
  effectiveAiAccess,
  maskedKey,
  modelAllowedFor,
  formatUtcDate,
  freeLimitText,
  freeTierModel,
  freeTierUsageText,
  FREE_TIER_MODELS,
  isOwnerAccount,
  parseOwnerAccounts,
  SKIP_REASON_LABELS,
  SKIP_REASONS,
  startOfNextUtcMonth,
} from '../src';
import { createSecretBox, hasSecretKeyMaterial, SecretKeyMissingError, secretHint } from '../src/secret-box';

describe('free tier models', () => {
  it('keeps Haiku and Sonnet, runs Opus on Sonnet with a note', () => {
    expect(FREE_TIER_MODELS).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(freeTierModel('claude-haiku-5-5')).toEqual({ model: 'claude-haiku-5-5', note: null });
    expect(freeTierModel('claude-sonnet-5-5')).toEqual({ model: 'claude-sonnet-5-5', note: null });
    expect(freeTierModel('claude-opus-5-5')).toEqual({
      model: 'claude-sonnet-5-5',
      note: 'Ran on Claude Sonnet 5.5: Opus needs your own API key.',
    });
  });
});

describe('owner accounts', () => {
  it('parses a comma-separated list, case-insensitive, without blanks or @', () => {
    expect(parseOwnerAccounts(undefined)).toEqual([]);
    expect(parseOwnerAccounts('')).toEqual([]);
    expect(parseOwnerAccounts(' yaserrar , @Northwind-Labs,,YASERRAR ')).toEqual([
      'yaserrar',
      'northwind-labs',
    ]);
  });

  it('matches logins in any case', () => {
    const owners = parseOwnerAccounts('yaserrar');
    expect(isOwnerAccount('YaSerrar', owners)).toBe(true);
    expect(isOwnerAccount('someone-else', owners)).toBe(false);
    expect(isOwnerAccount('yaserrar', [])).toBe(false);
  });
});

describe('free tier texts', () => {
  it('resets on the 1st of the next UTC month', () => {
    expect(startOfNextUtcMonth(new Date('2026-11-30T23:59:59Z')).toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
    expect(startOfNextUtcMonth(new Date('2026-12-15T10:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(formatUtcDate(new Date('2026-12-01T00:00:00Z'))).toBe('December 1, 2026');
  });

  it('names the account, the date and the way out', () => {
    expect(freeLimitText('acme', new Date('2026-12-01T00:00:00Z'))).toBe(
      'Free reviews for acme are used up until December 1, 2026. Add your own Anthropic API key in Revo for unlimited reviews.',
    );
    expect(freeTierUsageText(3, 20)).toBe("on Revo's free tier (3 of 20 reviews this month)");
    expect(accountKeyRefusedText('acme')).toBe(
      'The Anthropic API key saved for acme was refused. Update it in Revo.',
    );
  });

  it('labels the new skip reasons', () => {
    expect(SKIP_REASONS).toContain('free_limit');
    expect(SKIP_REASONS).toContain('free_paused');
    expect(SKIP_REASON_LABELS.free_limit).toBeTruthy();
    expect(SKIP_REASON_LABELS.free_paused).toBeTruthy();
  });
});

describe('secret box', () => {
  const box = createSecretBox({ encryptionKey: 'k'.repeat(32) });

  it('round-trips an API key and never stores the plain value', () => {
    const key = 'sk-ant-api03-example-value-abcd';
    const enc = box.encrypt(key);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain(key);
    expect(box.decrypt(enc)).toBe(key);
    expect(box.encrypt(key)).not.toBe(enc);
  });

  it('reads what another process encrypted with the same material', () => {
    const web = createSecretBox({ authSecret: 'a'.repeat(32) });
    const worker = createSecretBox({ authSecret: 'a'.repeat(32), encryptionKey: undefined });
    expect(worker.decrypt(web.encrypt('shared'))).toBe('shared');
    // TOKEN_ENCRYPTION_KEY wins over AUTH_SECRET: a box without it cannot read.
    const other = createSecretBox({ authSecret: 'a'.repeat(32), encryptionKey: 'k'.repeat(32) });
    expect(() => other.decrypt(web.encrypt('shared'))).toThrow();
    expect(box.decrypt(other.encrypt('same key'))).toBe('same key');
  });

  it('rejects tampered payloads and unknown formats', () => {
    const [v, iv, tag, data] = box.encrypt('value').split('.');
    const bytes = Buffer.from(data!, 'base64url');
    bytes[0] = bytes[0]! ^ 0x01;
    expect(() => box.decrypt([v, iv, tag, bytes.toString('base64url')].join('.'))).toThrow();
    expect(() => box.decrypt('nope')).toThrow(/format/);
  });

  it('needs key material', () => {
    expect(hasSecretKeyMaterial({})).toBe(false);
    expect(hasSecretKeyMaterial({ authSecret: 'x' })).toBe(true);
    expect(() => createSecretBox({})).toThrow(SecretKeyMissingError);
  });

  it('hints with the last 4 characters only', () => {
    expect(secretHint('sk-ant-api03-xyz-abcd')).toBe('abcd');
  });
});

describe('effective AI access', () => {
  const server = { ownerAccounts: ['yaserrar'], allowSubscription: false };
  const account = (over: Partial<Parameters<typeof effectiveAiAccess>[0]> = {}) => ({
    accountLogin: 'northwind-labs',
    aiAccess: 'free' as const,
    hasKey: false,
    ...over,
  });

  it('uses the saved key only when one is saved', () => {
    expect(effectiveAiAccess(account({ aiAccess: 'own_key', hasKey: true }), server)).toBe('own_key');
    expect(effectiveAiAccess(account({ aiAccess: 'own_key', hasKey: false }), server)).toBe('free');
    // A saved key that is not selected is not used.
    expect(effectiveAiAccess(account({ hasKey: true }), server)).toBe('free');
  });

  it('offers the subscription only where the server allows it', () => {
    expect(effectiveAiAccess(account({ aiAccess: 'subscription' }), server)).toBe('free');
    expect(
      effectiveAiAccess(account({ aiAccess: 'subscription' }), { ...server, allowSubscription: true }),
    ).toBe('subscription');
  });

  it('gives owner accounts Revo key without limits, unless they chose otherwise', () => {
    expect(effectiveAiAccess(account({ accountLogin: 'YaSerrar' }), server)).toBe('owner');
    expect(
      effectiveAiAccess(account({ accountLogin: 'yaserrar', aiAccess: 'own_key', hasKey: true }), server),
    ).toBe('own_key');
  });

  it('refuses Opus on the free tier only', () => {
    expect(modelAllowedFor('claude-opus-5-5', 'free')).toBe(false);
    expect(modelAllowedFor('claude-sonnet-5-5', 'free')).toBe(true);
    expect(modelAllowedFor('claude-haiku-5-5', 'free')).toBe(true);
    for (const access of ['owner', 'own_key', 'subscription'] as const)
      expect(modelAllowedFor('claude-opus-5-5', access)).toBe(true);
  });

  it('masks a key down to its hint', () => {
    expect(maskedKey('abcd')).toBe('sk-ant-…abcd');
  });
});
