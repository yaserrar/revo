import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { notFound } from './errors';
import { toErrorResponse } from './error-response';

describe('toErrorResponse', () => {
  it('maps HttpError to its status and code', async () => {
    const res = toErrorResponse(notFound('Repo'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'Repo not found.', code: 'NOT_FOUND' });
  });

  it('maps Zod errors to 400 with issues', async () => {
    const err = z.object({ page: z.number() }).safeParse({ page: 'x' }).error!;
    const res = toErrorResponse(err);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.issues[0].path).toEqual(['page']);
  });
});
