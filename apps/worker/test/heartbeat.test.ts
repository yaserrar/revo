import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startHeartbeat } from '../src/heartbeat';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('startHeartbeat', () => {
  it('writes the time while healthy and skips beats otherwise', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'revo-heartbeat-'));
    const file = join(dir, 'beat');
    let healthy = false;
    const stop = startHeartbeat(async () => healthy, { file, everyMs: 20 });
    await wait(50);
    expect(existsSync(file)).toBe(false);

    healthy = true;
    await wait(50);
    expect(Date.now() - Date.parse(readFileSync(file, 'utf8'))).toBeLessThan(1000);

    stop();
    await wait(10);
    const last = readFileSync(file, 'utf8');
    await wait(60);
    expect(readFileSync(file, 'utf8')).toBe(last);
  });

  it('treats a failing check as unhealthy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'revo-heartbeat-'));
    const file = join(dir, 'beat');
    const stop = startHeartbeat(async () => Promise.reject(new Error('db down')), { file, everyMs: 20 });
    await wait(50);
    stop();
    expect(existsSync(file)).toBe(false);
  });
});
