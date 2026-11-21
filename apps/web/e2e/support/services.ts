import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/** Root of the monorepo and its .env (the same file every app reads). */
export const ROOT = resolve(import.meta.dirname, '../../../..');
const ROOT_ENV = resolve(ROOT, '.env');

/** Values from the root .env, without touching this process's environment. */
export function rootEnv(): Record<string, string | undefined> {
  try {
    return parseEnv(readFileSync(ROOT_ENV, 'utf8'));
  } catch {
    return {};
  }
}

export const MOCK_URL = 'http://localhost:4830';
export const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3831';

export type RunningWorker = { stop: () => Promise<void>; output: () => string };

/**
 * Starts the Revo worker (tsx, root .env) with extra environment, and waits
 * for "worker ready". The e2e suite owns it, so a test can restart it with
 * another engine (e.g. a failing Claude API).
 */
export async function startWorker(extraEnv: Record<string, string> = {}): Promise<RunningWorker> {
  const workerDir = resolve(ROOT, 'apps/worker');
  const child: ChildProcess = spawn(
    resolve(workerDir, 'node_modules/.bin/tsx'),
    [`--env-file-if-exists=${ROOT_ENV}`, 'src/index.ts'],
    {
      cwd: workerDir,
      env: {
        ...process.env,
        APP_URL: WEB_URL,
        GITHUB_API_URL: MOCK_URL,
        REVO_ENGINE: 'fake',
        LOG_LEVEL: 'info',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error(`worker did not start:\n${log}`)), 30_000);
    const onData = (chunk: Buffer) => {
      log += chunk.toString();
      if (log.includes('worker ready')) {
        clearTimeout(timer);
        ready();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    void exited.then((code) => {
      clearTimeout(timer);
      fail(new Error(`worker exited with ${code}:\n${log}`));
    });
  });
  return {
    output: () => log,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await exited;
    },
  };
}

type Json = Record<string, unknown>;

/** Calls a mock GitHub test hook (POST /__mock/…) and returns its JSON. */
export async function mock<T = Json>(path: string, body?: Json): Promise<T> {
  const res = await fetch(`${MOCK_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`mock ${path} answered ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** Retries `read` until `done` accepts its value (polling the mock or the API). */
export async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  { timeoutMs = 45_000, what = 'condition' }: { timeoutMs?: number; what?: string } = {},
): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < until) {
    last = await read();
    if (done(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${what}. Last value: ${JSON.stringify(last)?.slice(0, 2000)}`);
}
