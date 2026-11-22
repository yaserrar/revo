import { rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Touched while the worker is healthy; the Docker healthcheck reads its age. */
export const HEARTBEAT_FILE = join(tmpdir(), 'revo-worker.heartbeat');

/**
 * Writes the current time to `file` every `everyMs` while `healthy()` says
 * so (BullMQ worker running, Postgres answering). A stuck event loop or a
 * lost database stops the beat and the container turns unhealthy.
 * Returns a function that stops the beat.
 */
export function startHeartbeat(
  healthy: () => Promise<boolean>,
  { file = HEARTBEAT_FILE, everyMs = 15_000 }: { file?: string; everyMs?: number } = {},
): () => void {
  let stopped = false;
  const beat = async () => {
    try {
      if ((await healthy()) && !stopped) {
        // Write then rename: a reader (the healthcheck, a test) never sees a half-written file.
        const tmp = `${file}.tmp`;
        await writeFile(tmp, new Date().toISOString());
        await rename(tmp, file);
      }
    } catch {
      // An unhealthy check simply skips the beat.
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), everyMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
