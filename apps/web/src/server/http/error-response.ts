import 'server-only';
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { Prisma } from '@revo/db';
import type { ApiErrorBody } from '@revo/shared';
import { logger } from '../config/logger';
import { HttpError } from './errors';

function json(body: ApiErrorBody, status: number, headers?: HeadersInit) {
  return Response.json(body, { status, headers });
}

/** Maps any thrown value to the `{ message, code, details?, issues? }` contract. */
export function toErrorResponse(err: unknown, req?: NextRequest): Response {
  if (err instanceof HttpError) {
    const retry = (err.details as { retryAfterSec?: number } | undefined)?.retryAfterSec;
    return json(
      {
        message: err.message,
        code: err.code,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
      err.status,
      retry ? { 'Retry-After': String(retry) } : undefined,
    );
  }
  if (err instanceof ZodError) {
    return json(
      {
        message: 'Some fields are invalid.',
        code: 'VALIDATION_ERROR',
        issues: err.issues.map((i) => ({
          path: i.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
          message: i.message,
        })),
      },
      400,
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return json({ message: 'Not found.', code: 'NOT_FOUND' }, 404);
    if (err.code === 'P2002') return json({ message: 'This already exists.', code: 'CONFLICT' }, 409);
  }
  logger.error({ err, path: req?.nextUrl.pathname }, 'unhandled route error');
  return json({ message: 'Something went wrong on our side.', code: 'INTERNAL' }, 500);
}
