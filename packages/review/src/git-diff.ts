/**
 * Splits a multi-file unified diff (`git diff`, `git format-patch`) into the
 * ChangedFile shape GitHub gives per file, so local diffs and eval cases go
 * through the same pipeline as real PRs.
 */
import type { ChangedFile, ChangedFileStatus } from './types';

const unquote = (p: string) => p.replace(/^"|"$/g, '');
const stripPrefix = (p: string) => unquote(p).replace(/^[ab]\//, '');

export function parseGitDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const chunks = diff.split(/^diff --git /m).slice(1);
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const header = /^(\S+) (\S+)/.exec(lines[0] ?? '');
    let oldPath = header ? stripPrefix(header[1]!) : '';
    let newPath = header ? stripPrefix(header[2]!) : '';
    let status: ChangedFileStatus = 'modified';
    let binary = false;
    const patchLines: string[] = [];
    let inHunks = false;

    for (const line of lines.slice(1)) {
      if (inHunks) {
        patchLines.push(line);
        continue;
      }
      if (line.startsWith('new file mode')) status = 'added';
      else if (line.startsWith('deleted file mode')) status = 'removed';
      else if (line.startsWith('rename from ')) {
        oldPath = line.slice('rename from '.length);
        status = 'renamed';
      } else if (line.startsWith('rename to ')) newPath = line.slice('rename to '.length);
      else if (line.startsWith('Binary files')) binary = true;
      else if (line.startsWith('--- ') && line !== '--- /dev/null') oldPath = stripPrefix(line.slice(4));
      else if (line.startsWith('+++ ') && line !== '+++ /dev/null') newPath = stripPrefix(line.slice(4));
      else if (line.startsWith('@@')) {
        inHunks = true;
        patchLines.push(line);
      }
    }
    while (patchLines.length > 0 && patchLines[patchLines.length - 1] === '') patchLines.pop();

    const patch = binary || patchLines.length === 0 ? undefined : patchLines.join('\n');
    let additions = 0;
    let deletions = 0;
    for (const l of patchLines) {
      if (l.startsWith('+')) additions++;
      else if (l.startsWith('-')) deletions++;
    }
    files.push({
      path: status === 'removed' ? oldPath : newPath,
      ...(status === 'renamed' ? { previousPath: oldPath } : {}),
      status,
      ...(patch ? { patch } : {}),
      additions,
      deletions,
    });
  }
  return files;
}
