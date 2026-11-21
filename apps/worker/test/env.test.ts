import { describe, expect, it } from 'vitest';
import { githubApiUrl, githubConfig, loadEnv } from '../src/env';

const base = {
  DATABASE_URL: 'postgresql://localhost/revo',
  REDIS_URL: 'redis://localhost:6379/7',
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
  // A local run against the mock GitHub (the fake engine is refused with the real one).
  GITHUB_API_URL: 'http://localhost:4830',
};

describe('loadEnv', () => {
  it('treats an empty REVO_ENGINE (env files, Compose) as unset', () => {
    expect(loadEnv({ ...base, REVO_ENGINE: '' }).REVO_ENGINE).toBe('fake');
    expect(loadEnv({ ...base, REVO_ENGINE: '', ANTHROPIC_API_KEY: 'sk-ant-x' }).REVO_ENGINE).toBe('claude');
  });

  it('defaults to the fake engine without a Claude key', () => {
    expect(loadEnv(base)).toMatchObject({
      REVO_ENGINE: 'fake',
      REVIEW_DEBOUNCE_SECONDS: 90,
      WORKER_CONCURRENCY: 2,
      REVO_QUEUE_PREFIX: 'revo',
    });
  });

  it('treats an empty queue prefix as the default', () => {
    expect(loadEnv({ ...base, REVO_QUEUE_PREFIX: '' }).REVO_QUEUE_PREFIX).toBe('revo');
  });

  it('uses Claude when a key is set', () => {
    expect(loadEnv({ ...base, ANTHROPIC_API_KEY: 'k' }).REVO_ENGINE).toBe('claude');
  });

  it('lists every missing variable', () => {
    expect(() => loadEnv({ REVO_ENGINE: 'claude' })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*GITHUB_APP_ID[\s\S]*GITHUB_APP_PRIVATE_KEY/,
    );
  });

  it('refuses the fake engine with the real GitHub unless in test mode', () => {
    const real = { ...base, GITHUB_API_URL: undefined };
    expect(() => loadEnv(real)).toThrow(/REVO_ENGINE: the fake engine is refused with the real GitHub/);
    expect(() => loadEnv({ ...real, REVO_ENGINE: 'fake' })).toThrow(/refused with the real GitHub/);
    expect(loadEnv({ ...real, REVO_TEST_MODE: '1' }).REVO_ENGINE).toBe('fake');
    expect(loadEnv({ ...real, ANTHROPIC_API_KEY: 'sk-ant-x' }).REVO_ENGINE).toBe('claude');
    // Production ignores a non-local mock URL, so it counts as the real GitHub.
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() => loadEnv(prod)).toThrow(/refused with the real GitHub/);
    expect(loadEnv({ ...prod, REVO_TEST_MODE: '1' }).REVO_ENGINE).toBe('fake');
  });

  it('requires a key for the Claude engine', () => {
    expect(() => loadEnv({ ...base, REVO_ENGINE: 'claude' })).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('GitHub settings', () => {
  it('honours the mock URL outside production only', () => {
    expect(githubApiUrl(loadEnv({ ...base, GITHUB_API_URL: 'http://localhost:4830/' }))).toBe(
      'http://localhost:4830',
    );
    const prod = {
      ...base,
      NODE_ENV: 'production',
      ANTHROPIC_API_KEY: 'sk-ant-x',
      GITHUB_API_URL: 'http://localhost:4830',
    };
    expect(githubApiUrl(loadEnv(prod))).toBe('https://api.github.com');
    expect(githubApiUrl(loadEnv({ ...prod, REVO_TEST_MODE: '1' }))).toBe('http://localhost:4830');
    expect(githubApiUrl(loadEnv({ ...prod, REVO_TEST_MODE: '1', GITHUB_API_URL: 'http://evil.test' }))).toBe(
      'https://api.github.com',
    );
  });

  it('unescapes the private key', () => {
    expect(githubConfig(loadEnv(base))).toMatchObject({
      appId: 1,
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    });
  });
});
