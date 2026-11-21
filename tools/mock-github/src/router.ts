import type { IncomingMessage, ServerResponse } from 'node:http';

export type MockRequest = {
  method: string;
  url: URL;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  /** Parsed JSON or form body (empty object when none). */
  body: Record<string, string>;
  /** Bearer/token value of the Authorization header, if any. */
  token: string | null;
};

export type MockResponse = {
  status?: number;
  json?: unknown;
  headers?: Record<string, string>;
  text?: string;
};
export type MockHandler = (req: MockRequest) => MockResponse | Promise<MockResponse>;
export type MockRoute = { method: string; path: string; handler: MockHandler };

/**
 * `/user/installations/:id/repositories` → regex with named groups. A
 * trailing `*` (`:path*`) matches the rest of the URL, slashes included.
 */
function compile(path: string): RegExp {
  return new RegExp(
    '^' +
      path.replace(
        /:(\w+)(\*)?/g,
        (_m, name: string, rest?: string) => `(?<${name}>${rest ? '.+' : '[^/]+'})`,
      ) +
      '/?$',
  );
}

async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  if ((req.headers['content-type'] ?? '').includes('application/json'))
    return JSON.parse(raw) as Record<string, string>;
  return Object.fromEntries(new URLSearchParams(raw));
}

/** A status to answer instead of the route (injected failures), or null. */
export type FailureHook = (method: string, pathname: string) => number | null;

export function createRouter(routes: MockRoute[], failure: FailureHook = () => null) {
  const compiled = routes.map((r) => ({ ...r, re: compile(r.path) }));
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://mock.local');
    const injected = failure(req.method ?? 'GET', decodeURIComponent(url.pathname));
    if (injected !== null) {
      for await (const _chunk of req) {
        // Drain the request body before answering.
      }
      res.writeHead(injected, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          message: injected === 403 ? 'Resource not accessible by integration' : 'Injected failure',
        }),
      );
      return;
    }
    const route = compiled.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not Found', path: url.pathname }));
      return;
    }
    const auth = req.headers.authorization ?? '';
    let out: MockResponse;
    try {
      out = await route.handler({
        method: req.method ?? 'GET',
        url,
        params: Object.fromEntries(
          Object.entries(route.re.exec(url.pathname)?.groups ?? {}).map(([k, v]) => [
            k,
            decodeURIComponent(v),
          ]),
        ),
        headers: req.headers,
        body: await readBody(req),
        token: /^(?:token|bearer)\s+(.+)$/i.exec(auth)?.[1] ?? null,
      });
    } catch (err) {
      // Errors carrying an HTTP status (MockError) answer like GitHub; anything else is a 500.
      const status =
        typeof (err as { status?: unknown }).status === 'number' ? (err as { status: number }).status : 500;
      out = { status, json: { message: err instanceof Error ? err.message : 'Mock error' } };
    }
    const headers = { ...(out.headers ?? {}) };
    if (out.json !== undefined) headers['content-type'] = 'application/json';
    res.writeHead(out.status ?? 200, headers);
    res.end(out.json !== undefined ? JSON.stringify(out.json) : (out.text ?? ''));
  };
}
