/**
 * Node-only helpers (`@revo/review/node`): read related files from a local
 * checkout. Kept out of the main entry so browser bundles never see node:fs.
 */
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { FileReader } from './related';

/**
 * A FileReader over a local folder. `overlay` holds new contents that win
 * over the disk (changed files whose diff is not applied in the folder);
 * a null overlay entry means the file does not exist at the PR head.
 */
export function createDirectoryReader(
  root: string,
  overlay: ReadonlyMap<string, string | null> = new Map(),
): FileReader {
  const base = resolve(root);
  return async (path) => {
    if (overlay.has(path)) return overlay.get(path) ?? null;
    const full = resolve(base, path);
    if (full !== base && !full.startsWith(base + sep)) return null;
    try {
      return await readFile(full, 'utf8');
    } catch {
      return null;
    }
  };
}
