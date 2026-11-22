/**
 * The key check with the real Anthropic SDK against the mock GitHub's stand-in
 * Claude API (GET /anthropic/v1/models), never Anthropic: accepted, refused,
 * and no answer.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockGithubServer } from '@revo/mock-github';

const { server } = createMockGithubServer({ baseUrl: 'http://localhost' });
let checkAnthropicKey: (key: string) => Promise<string>;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  // The env module reads ANTHROPIC_BASE_URL when first imported.
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${(server.address() as AddressInfo).port}/anthropic`;
  checkAnthropicKey = (await import('./anthropic-key')).checkAnthropicKey;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('checkAnthropicKey', () => {
  it('accepts a key the API accepts', async () => {
    expect(await checkAnthropicKey('sk-ant-mock-valid-key-0001')).toBe('valid');
  });

  it('reports a key the API refuses (401)', async () => {
    expect(await checkAnthropicKey('sk-ant-api03-unknown-key-0002')).toBe('refused');
  });

  it('reports no answer when the API cannot be reached', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await checkAnthropicKey('sk-ant-mock-valid-key-0003')).toBe('unavailable');
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });
});
