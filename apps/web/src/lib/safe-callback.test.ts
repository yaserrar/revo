import { describe, expect, it } from 'vitest';
import { safeCallbackPath } from './safe-callback';

const APP = 'https://revo.example.com';

describe('safeCallbackPath', () => {
  it('keeps same-site paths with their query and hash', () => {
    expect(safeCallbackPath('/prs?repo=1#top', APP)).toBe('/prs?repo=1#top');
    expect(safeCallbackPath(['/trends', '/x'], APP)).toBe('/trends');
  });

  it.each([
    undefined,
    '',
    'https://attacker.test/phish',
    '//attacker.test/phish',
    '/\\attacker.test/phish',
    '/\t/attacker.test',
    '/\n/attacker.test',
    'javascript:alert(1)',
    'prs',
  ])('refuses %j', (value) => {
    expect(safeCallbackPath(value, APP)).toBe('/overview');
  });
});
