import { describe, expect, it } from 'vitest';
import { readBodyText } from './body';
import { HttpError } from './errors';

function streamed(parts: string[], headers: Record<string, string> = {}): Request {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
  return new Request('http://localhost/x', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
}

describe('readBodyText', () => {
  it('reads a body under the limit', async () => {
    expect(await readBodyText(streamed(['{"a":', '1}']), 100)).toBe('{"a":1}');
  });

  it('refuses a declared Content-Length above the limit without reading', async () => {
    const err = await readBodyText(streamed(['x'], { 'content-length': '5000' }), 100).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(413);
  });

  it('stops reading once the streamed body passes the limit', async () => {
    const err = await readBodyText(streamed(['x'.repeat(60), 'y'.repeat(60)]), 100).catch((e) => e);
    expect((err as HttpError).status).toBe(413);
  });
});
