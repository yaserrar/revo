import { describe, expect, it } from 'vitest';
import { githubAppConfigFromEnv } from '../src/config';

describe('githubAppConfigFromEnv', () => {
  it('parses ids, unescapes the key and defaults the API url', () => {
    const cfg = githubAppConfigFromEnv({
      GITHUB_APP_ID: '123',
      GITHUB_APP_PRIVATE_KEY: '-----BEGIN KEY-----\\nabc\\n-----END KEY-----\\n',
      GITHUB_WEBHOOK_SECRET: 's3cret',
    });
    expect(cfg).toEqual({
      appId: 123,
      privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----',
      webhookSecret: 's3cret',
      apiUrl: 'https://api.github.com',
    });
  });

  it('uses GITHUB_API_URL when set and rejects missing values', () => {
    expect(
      githubAppConfigFromEnv({
        GITHUB_APP_ID: '1',
        GITHUB_APP_PRIVATE_KEY: 'k',
        GITHUB_WEBHOOK_SECRET: 's',
        GITHUB_API_URL: 'http://localhost:4830',
      }).apiUrl,
    ).toBe('http://localhost:4830');
    expect(() => githubAppConfigFromEnv({})).toThrow();
  });
});
