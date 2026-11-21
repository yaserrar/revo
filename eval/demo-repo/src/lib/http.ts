import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const badRequest = (message: string) => new HttpError(400, message);

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler: HttpError and validation errors become JSON responses, anything else a 500. */
export function handle<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
      if (err instanceof ZodError) return json({ error: 'Invalid input', issues: err.issues }, { status: 400 });
      console.error('Unhandled error', err);
      return json({ error: 'Something went wrong' }, { status: 500 });
    }
  };
}
