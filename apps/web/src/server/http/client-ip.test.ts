import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe('clientIp', () => {
  it('prefers the client address Cloudflare reports over its own edge address', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '172.70.1.2' }))).toBe(
      '203.0.113.7',
    );
  });

  it('falls back to the first forwarded address, then X-Real-IP', () => {
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.4, 10.0.0.2' }))).toBe('198.51.100.4');
    expect(clientIp(req({ 'x-real-ip': '198.51.100.9' }))).toBe('198.51.100.9');
    expect(clientIp(req({}))).toBe('unknown');
  });
});
