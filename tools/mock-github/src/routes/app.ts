import {
  MOCK_APP_ID,
  MOCK_APP_SLUG,
  MockError,
  type MockAppState,
  type MockPull,
  type MockRepo,
} from '../app-state';
import type { MockRequest, MockResponse, MockRoute } from '../router';

/**
 * REST endpoints a GitHub App calls (api.github.com), exactly the ones Revo
 * uses: installation tokens, pull requests and their files, file contents,
 * check runs, issue comments, PR reviews and review comments.
 */

type Json = Record<string, unknown>;

const notFound = (): MockResponse => ({ status: 404, json: { message: 'Not Found' } });

function decodeJwtPayload(jwt: string): Json | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Json;
  } catch {
    return null;
  }
}

/** Repo of the URL, reachable with the request's installation token. */
function repoFor(state: MockAppState, req: MockRequest): MockRepo {
  const installationId = state.installationForToken(req.token);
  if (installationId === null) throw new MockError(401, 'Bad credentials');
  const repo = state.repoByName(req.params.owner ?? '', req.params.repo ?? '');
  if (!repo || repo.installationId !== installationId) throw new MockError(404, 'Not Found');
  return repo;
}

function pullFor(state: MockAppState, req: MockRequest): { repo: MockRepo; pull: MockPull } {
  const repo = repoFor(state, req);
  return { repo, pull: state.findPull(repo.id, Number(req.params.number)) };
}

/** GitHub-style page of a list, with a Link header to the next page. */
function page<T>(req: MockRequest, items: T[]): MockResponse {
  const perPage = Math.min(100, Math.max(1, Number(req.url.searchParams.get('per_page') ?? 30)));
  const pageNo = Math.max(1, Number(req.url.searchParams.get('page') ?? 1));
  const slice = items.slice((pageNo - 1) * perPage, pageNo * perPage);
  const headers: Record<string, string> = {};
  if (pageNo * perPage < items.length) {
    const next = new URL(`http://${req.headers.host ?? 'localhost'}${req.url.pathname}`);
    req.url.searchParams.forEach((v, k) => next.searchParams.set(k, v));
    next.searchParams.set('page', String(pageNo + 1));
    next.searchParams.set('per_page', String(perPage));
    headers.link = `<${next.toString()}>; rel="next"`;
  }
  return { json: slice, headers };
}

function body(req: MockRequest): Json {
  return req.body as unknown as Json;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function appRoutes(state: MockAppState): MockRoute[] {
  const issueCommentJson = (c: {
    id: number;
    body: string;
    createdAt: string;
    updatedAt: string;
    author?: { login: string; id: number; type: string };
  }) => ({
    id: c.id,
    body: c.body,
    user: c.author ?? state.bot,
    ...(c.author ? {} : { performed_via_github_app: { id: MOCK_APP_ID, slug: MOCK_APP_SLUG } }),
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  });
  const checkRunJson = (id: number) => {
    const c = state.checkRuns.get(id)!;
    return {
      id: c.id,
      name: c.name,
      head_sha: c.headSha,
      status: c.status,
      conclusion: c.conclusion,
      details_url: c.detailsUrl,
      output: { title: c.title, summary: c.summary },
    };
  };
  const reviewCommentJson = (c: (typeof state.reviewComments)[number]) => ({
    id: c.id,
    pull_request_review_id: c.reviewId,
    commit_id: c.commitId,
    path: c.path,
    line: c.line,
    start_line: c.startLine,
    side: c.side,
    body: c.body,
    user: c.author ?? state.bot,
  });

  const appClaims = (token: string | null) => {
    const claims = token ? decodeJwtPayload(token) : null;
    const exp = num(claims?.exp);
    return claims && String(claims.iss) === String(MOCK_APP_ID) && exp && exp * 1000 >= Date.now()
      ? claims
      : null;
  };

  return [
    {
      method: 'GET',
      path: '/app',
      handler: ({ token }) =>
        appClaims(token)
          ? { json: { id: MOCK_APP_ID, slug: MOCK_APP_SLUG, name: 'Revo (dev)' } }
          : { status: 401, json: { message: 'A JSON web token could not be decoded' } },
    },
    {
      method: 'POST',
      path: '/app/installations/:id/access_tokens',
      handler: ({ token, params }) => {
        const claims = token ? decodeJwtPayload(token) : null;
        const exp = num(claims?.exp);
        if (!claims || String(claims.iss) !== String(MOCK_APP_ID) || !exp || exp * 1000 < Date.now())
          return { status: 401, json: { message: 'A JSON web token could not be decoded' } };
        const installation = state.installations.get(Number(params.id));
        if (!installation) return notFound();
        if (installation.suspendedAt)
          return { status: 403, json: { message: 'This installation has been suspended' } };
        const issued = state.issueInstallationToken(installation.id);
        return {
          status: 201,
          json: {
            token: issued.token,
            expires_at: issued.expiresAt,
            permissions: { pull_requests: 'write', checks: 'write', contents: 'read', metadata: 'read' },
            repository_selection: 'selected',
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/repos/:owner/:repo/pulls/:number',
      handler: (req) => ({ json: state.pullPayload(pullFor(state, req).pull) }),
    },
    {
      method: 'GET',
      path: '/repos/:owner/:repo/pulls/:number/files',
      handler: (req) => page(req, state.pullFiles(pullFor(state, req).pull)),
    },
    {
      method: 'GET',
      path: '/repos/:owner/:repo/compare/:basehead',
      handler: (req) => {
        const repo = repoFor(state, req);
        const [base, head] = (req.params.basehead ?? '').split('...');
        const result = base && head ? state.compare(repo.id, base, head) : null;
        return result ? { json: result } : notFound();
      },
    },
    {
      method: 'GET',
      path: '/search/code',
      handler: (req) => {
        const installationId = state.installationForToken(req.token);
        if (installationId === null) throw new MockError(401, 'Bad credentials');
        const q = req.url.searchParams.get('q') ?? '';
        const repoName = /(?:^|\s)repo:(\S+)/.exec(q)?.[1] ?? '';
        const term = q
          .replace(/(?:^|\s)repo:\S+/, '')
          .trim()
          .replace(/^"(.*)"$/, '$1');
        const [owner = '', name = ''] = repoName.split('/');
        const repo = state.repoByName(owner, name);
        if (!repo || repo.installationId !== installationId || !term)
          return { status: 422, json: { message: 'Validation Failed' } };
        const items = state.searchCode(repo.id, term).map((path) => ({ name: path.split('/').pop(), path }));
        return { json: { total_count: items.length, incomplete_results: false, items } };
      },
    },
    {
      method: 'GET',
      path: '/repos/:owner/:repo/contents/:path*',
      handler: (req) => {
        const repo = repoFor(state, req);
        const path = req.params.path ?? '';
        const content = state.contentAt(repo.id, path, req.url.searchParams.get('ref') ?? 'main');
        if (content === null) return notFound();
        const bytes = Buffer.from(content, 'utf8');
        return {
          json: {
            type: 'file',
            name: path.split('/').pop(),
            path,
            size: bytes.length,
            encoding: 'base64',
            content: bytes.toString('base64'),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/repos/:owner/:repo/check-runs',
      handler: (req) => {
        const repo = repoFor(state, req);
        const b = body(req);
        const output = (b.output ?? {}) as Json;
        const headSha = str(b.head_sha);
        const name = str(b.name);
        if (!headSha || !name) return { status: 422, json: { message: 'name and head_sha are required' } };
        const status = str(b.status) ?? 'queued';
        const conclusion = str(b.conclusion) ?? null;
        const title = str(output.title) ?? '';
        const id = state.nextObjectId();
        state.checkRuns.set(id, {
          id,
          repoId: repo.id,
          name,
          headSha,
          status,
          conclusion,
          title,
          summary: str(output.summary) ?? '',
          detailsUrl: str(b.details_url) ?? null,
          history: [{ status, conclusion, title }],
        });
        return { status: 201, json: checkRunJson(id) };
      },
    },
    {
      method: 'PATCH',
      path: '/repos/:owner/:repo/check-runs/:id',
      handler: (req) => {
        const repo = repoFor(state, req);
        const check = state.checkRuns.get(Number(req.params.id));
        if (!check || check.repoId !== repo.id) return notFound();
        const b = body(req);
        const output = (b.output ?? {}) as Json;
        check.status = str(b.status) ?? check.status;
        check.conclusion = str(b.conclusion) ?? (check.status === 'completed' ? check.conclusion : null);
        check.title = str(output.title) ?? check.title;
        check.summary = str(output.summary) ?? check.summary;
        check.detailsUrl = str(b.details_url) ?? check.detailsUrl;
        check.history.push({ status: check.status, conclusion: check.conclusion, title: check.title });
        return { json: checkRunJson(check.id) };
      },
    },
    {
      method: 'GET',
      path: '/repos/:owner/:repo/commits/:ref/check-runs',
      handler: (req) => {
        const repo = repoFor(state, req);
        const runs = [...state.checkRuns.values()].filter(
          (c) => c.repoId === repo.id && c.headSha === req.params.ref,
        );
        return { json: { total_count: runs.length, check_runs: runs.map((c) => checkRunJson(c.id)) } };
      },
    },
    {
      method: 'GET',
      path: '/repos/:owner/:repo/issues/:number/comments',
      handler: (req) => {
        const { repo, pull } = pullFor(state, req);
        const comments = [...state.issueComments.values()].filter(
          (c) => c.repoId === repo.id && c.number === pull.number,
        );
        return page(req, comments.map(issueCommentJson));
      },
    },
    {
      method: 'POST',
      path: '/repos/:owner/:repo/issues/:number/comments',
      handler: (req) => {
        const { repo, pull } = pullFor(state, req);
        const text = str(body(req).body);
        if (!text) return { status: 422, json: { message: 'body is required' } };
        const now = new Date().toISOString();
        const comment = {
          id: state.nextObjectId(),
          repoId: repo.id,
          number: pull.number,
          body: text,
          createdAt: now,
          updatedAt: now,
          edits: 0,
        };
        state.issueComments.set(comment.id, comment);
        return { status: 201, json: issueCommentJson(comment) };
      },
    },
    {
      method: 'PATCH',
      path: '/repos/:owner/:repo/issues/comments/:id',
      handler: (req) => {
        const repo = repoFor(state, req);
        const comment = state.issueComments.get(Number(req.params.id));
        if (!comment || comment.repoId !== repo.id) return notFound();
        // Like GitHub: an App may only edit its own comments.
        if (comment.author)
          return { status: 403, json: { message: 'Resource not accessible by integration' } };
        const text = str(body(req).body);
        if (!text) return { status: 422, json: { message: 'body is required' } };
        comment.body = text;
        comment.updatedAt = new Date().toISOString();
        comment.edits++;
        return { json: issueCommentJson(comment) };
      },
    },
    {
      method: 'GET',
      path: '/repos/:owner/:repo/pulls/:number/comments',
      handler: (req) => {
        const { repo, pull } = pullFor(state, req);
        return page(
          req,
          state.reviewComments
            .filter((c) => c.repoId === repo.id && c.number === pull.number)
            .map(reviewCommentJson),
        );
      },
    },
    {
      method: 'POST',
      path: '/repos/:owner/:repo/pulls/:number/reviews',
      handler: (req) => {
        const { repo, pull } = pullFor(state, req);
        const b = body(req);
        const commitId = str(b.commit_id) ?? state.head(pull).sha;
        if (!pull.commits.some((c) => c.sha === commitId))
          return {
            status: 422,
            json: { message: 'Unprocessable Entity', errors: ['commit_id is not part of the pull request'] },
          };
        const comments = Array.isArray(b.comments) ? (b.comments as Json[]) : [];
        // Like GitHub, every comment must sit on a line of the diff, on the RIGHT side here.
        for (const c of comments) {
          const path = str(c.path) ?? '';
          const line = num(c.line);
          const start = num(c.start_line);
          const lines = state.commentableLines(pull, path);
          const ok =
            line !== undefined &&
            lines.has(line) &&
            (c.side ?? 'RIGHT') === 'RIGHT' &&
            (start === undefined || (start < line && lines.has(start)));
          if (!ok || !str(c.body))
            return {
              status: 422,
              json: { message: 'Unprocessable Entity', errors: ['Line could not be resolved'] },
            };
        }
        const review = {
          id: state.nextObjectId(),
          repoId: repo.id,
          number: pull.number,
          commitId,
          event: str(b.event) ?? 'COMMENT',
          body: str(b.body) ?? '',
        };
        state.reviews.push(review);
        for (const c of comments) {
          state.reviewComments.push({
            id: state.nextObjectId(),
            reviewId: review.id,
            repoId: repo.id,
            number: pull.number,
            commitId,
            path: str(c.path)!,
            line: num(c.line)!,
            startLine: num(c.start_line) ?? null,
            side: 'RIGHT',
            body: str(c.body)!,
          });
        }
        return {
          json: {
            id: review.id,
            state: 'COMMENTED',
            commit_id: commitId,
            body: review.body,
            user: state.bot,
          },
        };
      },
    },
    {
      // The two GraphQL operations Revo sends: review threads with reactions, and resolving a thread.
      method: 'POST',
      path: '/graphql',
      handler: (req) => {
        const installationId = state.installationForToken(req.token);
        if (installationId === null) return { status: 401, json: { message: 'Bad credentials' } };
        const b = body(req);
        const query = str(b.query) ?? '';
        const vars = (typeof b.variables === 'object' && b.variables !== null ? b.variables : {}) as Json;
        if (query.includes('RevoReviewThreads')) {
          const repo = state.repoByName(str(vars.owner) ?? '', str(vars.repo) ?? '');
          if (!repo || repo.installationId !== installationId)
            return {
              json: { data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: 'Not found' }] },
            };
          const pull = state.findPull(repo.id, num(vars.number) ?? 0);
          const nodes = state.reviewThreads(pull).map((t) => {
            const groups = new Map<string, { login: string; userId: number }[]>();
            for (const r of t.reactions) groups.set(r.content, [...(groups.get(r.content) ?? []), r]);
            return {
              id: t.id,
              isResolved: t.isResolved,
              comments: {
                nodes: [
                  {
                    databaseId: t.commentId,
                    reactionGroups: [...groups].map(([content, users]) => ({
                      content,
                      reactors: {
                        nodes: users.map((u) => ({
                          __typename: 'User',
                          login: u.login,
                          databaseId: u.userId,
                        })),
                      },
                    })),
                  },
                ],
              },
            };
          });
          return {
            json: {
              data: {
                repository: {
                  pullRequest: {
                    reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
                  },
                },
              },
            },
          };
        }
        if (query.includes('RevoResolveThread')) {
          const threadId = str(vars.threadId) ?? '';
          const commentId = Number(threadId.replace(/^PRRT_/, ''));
          const comment = state.reviewComments.find((c) => c.id === commentId);
          const repo = comment ? state.repos.get(comment.repoId) : undefined;
          if (!comment || !repo || repo.installationId !== installationId)
            return {
              json: { data: null, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a node' }] },
            };
          state.resolvedThreads.set(comment.id, state.bot.login);
          return { json: { data: { resolveReviewThread: { thread: { id: threadId, isResolved: true } } } } };
        }
        return { status: 400, json: { message: 'Unsupported GraphQL operation in the mock' } };
      },
    },
    {
      method: 'GET',
      path: '/repos/:owner/:repo/pulls/:number/reviews/:reviewId/comments',
      handler: (req) => {
        const { repo, pull } = pullFor(state, req);
        const reviewId = Number(req.params.reviewId);
        return page(
          req,
          state.reviewComments
            .filter((c) => c.repoId === repo.id && c.number === pull.number && c.reviewId === reviewId)
            .map(reviewCommentJson),
        );
      },
    },
  ];
}
