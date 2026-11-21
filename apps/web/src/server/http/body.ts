import 'server-only';
import { HttpError } from './errors';

/** GitHub caps webhook payloads at 25 MB. */
export const WEBHOOK_BODY_LIMIT = 25 * 1024 * 1024;
/** Dashboard API bodies are small JSON (the largest is repo settings). */
export const JSON_BODY_LIMIT = 256 * 1024;

const tooLarge = (limit: number) =>
  new HttpError(413, 'PAYLOAD_TOO_LARGE', `The request body is larger than ${Math.round(limit / 1024)} KB.`);

/**
 * Reads a request body as text, stopping as soon as it passes `limit` bytes,
 * so an oversized request never fills the server's memory. A Content-Length
 * above the limit is refused before reading anything.
 */
export async function readBodyText(req: Request, limit: number): Promise<string> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(limit);
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size).toString('utf8');
}
