import 'server-only';
import type { NextRequest } from 'next/server';
import type { z } from 'zod';
import type { RepoPermission } from '@revo/shared';
import { accessibleRepoIds, assertRepoAccess, repoPermission } from '../auth/repo-access';
import { getSessionUser, type SessionUser } from '../auth/session';
import { JSON_BODY_LIMIT, readBodyText } from './body';
import { toErrorResponse } from './error-response';
import { unauthorized } from './errors';
import { assertRateLimit, RATE_LIMITS } from './rate-limit';

type Infer<T> = T extends z.ZodType ? z.infer<T> : undefined;
type AuthLevel = 'public' | 'user';

type RouteOptions<P, Q, B, A extends AuthLevel> = {
  /** 'user' (default) requires a session; 'public' allows anonymous calls (webhooks, health). */
  auth?: A;
  params?: P;
  query?: Q;
  body?: B;
  /** Status of a successful JSON response (default 200). */
  status?: number;
  /** Named limit from RATE_LIMITS, keyed by user (or IP for public routes). */
  rateLimit?: keyof typeof RATE_LIMITS;
};

/** Lazy, per-request view of what the user may access (spec 14). */
export type AccessScope = {
  /** Ids of every repo the user can see. Filter EVERY dashboard query by these. */
  repoIds: () => Promise<string[]>;
  /** Throws NOT_FOUND when the repo is not accessible. */
  assertRepo: (repoId: string) => Promise<void>;
  /** The user's GitHub role on a repo they can access (NOT_FOUND otherwise). */
  permission: (repoId: string) => Promise<RepoPermission>;
};

type HandlerContext<P, Q, B, A extends AuthLevel> = {
  req: NextRequest;
  user: A extends 'public' ? SessionUser | null : SessionUser;
  access: A extends 'public' ? AccessScope | null : AccessScope;
  params: Infer<P>;
  query: Infer<Q>;
  body: Infer<B>;
};

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  );
}

/** An empty or malformed body parses as `{}` (the schema then says what is missing). */
function parseJson(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
}

function scopeFor(user: SessionUser): AccessScope {
  let ids: Promise<string[]> | undefined;
  return {
    repoIds: () => (ids ??= accessibleRepoIds(user.id)),
    assertRepo: (repoId) => assertRepoAccess(user.id, repoId),
    permission: (repoId) => repoPermission(user.id, repoId),
  };
}

/**
 * Thin route-handler wrapper: authenticate → rate limit → parse params,
 * query and body with Zod → call the service → serialise. Errors map to the
 * `{ message, code, details?, issues? }` contract (ApiErrorBody).
 * Returning a Response passes it through; returning undefined gives 204.
 */
export function route<
  P extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
  A extends AuthLevel = 'user',
>(opts: RouteOptions<P, Q, B, A>, handler: (ctx: HandlerContext<P, Q, B, A>) => unknown) {
  return async (req: NextRequest, ctx: { params: Promise<unknown> }): Promise<Response> => {
    try {
      const level: AuthLevel = opts.auth ?? 'user';
      const user = await getSessionUser();
      if (level === 'user' && !user) throw unauthorized();

      if (opts.rateLimit) {
        const limit = RATE_LIMITS[opts.rateLimit];
        assertRateLimit(`${opts.rateLimit}:${user?.id ?? clientIp(req)}`, limit.max, limit.windowMs);
      }

      const rawParams = (await ctx?.params) ?? {};
      const params = opts.params ? opts.params.parse(rawParams) : undefined;
      const query = opts.query ? opts.query.parse(Object.fromEntries(req.nextUrl.searchParams)) : undefined;
      const body = opts.body
        ? opts.body.parse(parseJson(await readBodyText(req, JSON_BODY_LIMIT)))
        : undefined;

      const result = await handler({
        req,
        user,
        access: user ? scopeFor(user) : null,
        params,
        query,
        body,
      } as HandlerContext<P, Q, B, A>);
      if (result instanceof Response) return result;
      if (result === undefined) return new Response(null, { status: 204 });
      return Response.json(result, { status: opts.status ?? 200 });
    } catch (err) {
      return toErrorResponse(err, req);
    }
  };
}
