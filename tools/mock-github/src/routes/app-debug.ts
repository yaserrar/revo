import {
  MockError,
  reactionContent,
  type MockAppState,
  type MockFileChange,
  type MockPull,
} from '../app-state';
import type { MockRequest, MockRoute } from '../router';

/**
 * Test hooks under /__mock: set where webhooks go, install or uninstall the
 * app, open a PR from file contents, push a commit, close/merge/reopen, mark
 * ready, and read what Revo posted. Each action sends the signed webhook
 * GitHub would send and returns the delivery status.
 */

type Json = Record<string, unknown>;

const json = (req: MockRequest) => req.body as unknown as Json;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function fileChanges(state: MockAppState, repoId: number, value: unknown): MockFileChange[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new MockError(422, 'files must be a non-empty array');
  return (value as Json[]).map((f) => {
    const path = str(f.path);
    if (!path) throw new MockError(422, 'each file needs a path');
    const base = state.contentAt(repoId, path, 'main');
    return {
      path,
      before: f.before === undefined ? base : (str(f.before) ?? null),
      after: f.after === null ? null : (str(f.after) ?? ''),
    };
  });
}

export function appDebugRoutes(state: MockAppState): MockRoute[] {
  const repoOf = (req: MockRequest) => {
    const repo = state.repoByName(req.params.owner ?? '', req.params.repo ?? '');
    if (!repo) throw new MockError(404, 'Unknown repo');
    return repo;
  };
  const pullOf = (req: MockRequest): MockPull => state.findPull(repoOf(req).id, Number(req.params.number));
  const sendPull = async (action: string, pull: MockPull) => ({
    json: {
      number: pull.number,
      headSha: state.head(pull).sha,
      state: pull.state,
      delivery: await state.sendWebhook('pull_request', state.pullRequestEvent(action, pull)),
    },
  });

  return [
    {
      method: 'POST',
      path: '/__mock/webhook',
      handler: (req) => {
        const url = str(json(req).url);
        const secret = str(json(req).secret);
        if (!url || !secret) return { status: 422, json: { message: 'url and secret are required' } };
        state.webhookTarget = { url, secret };
        return { json: { url } };
      },
    },
    {
      method: 'GET',
      path: '/__mock/deliveries',
      handler: () => ({ json: state.deliveries }),
    },
    {
      // A new installation (account + repos, optional members = logins that see it), announced with installation.created.
      method: 'POST',
      path: '/__mock/installations',
      handler: async (req) => {
        const b = json(req);
        const id = Number(b.id);
        const login = str(b.login);
        const repos = Array.isArray(b.repos)
          ? (b.repos as { id: number; name: string; private?: boolean }[])
          : [];
        if (!Number.isInteger(id) || id <= 0 || !login || repos.length === 0)
          return { status: 422, json: { message: 'id, login and repos are required' } };
        if (state.installations.has(id)) return { status: 422, json: { message: 'Installation exists' } };
        const members = Array.isArray(b.members)
          ? (b.members as unknown[]).filter((m): m is string => typeof m === 'string')
          : undefined;
        const installation = state.addInstallation({
          id,
          account: { id, login, type: b.type === 'User' ? 'User' : 'Organization' },
          repos,
          ...(members ? { members } : {}),
        });
        const delivery = await state.sendWebhook('installation', {
          action: 'created',
          installation: state.installationPayload(installation),
          repositories: state.reposOf(id).map((r) => state.repoPayload(r)),
        });
        return { status: 201, json: { id, delivery } };
      },
    },
    {
      method: 'POST',
      path: '/__mock/installations/:id/install',
      handler: async ({ params }) => {
        const installation = state.requireInstallation(Number(params.id));
        const delivery = await state.sendWebhook('installation', {
          action: 'created',
          installation: state.installationPayload(installation),
          repositories: state.reposOf(installation.id).map((r) => state.repoPayload(r)),
        });
        return { json: { delivery } };
      },
    },
    {
      method: 'POST',
      path: '/__mock/installations/:id/uninstall',
      handler: async ({ params }) => {
        const { installation } = state.removeInstallation(Number(params.id));
        const delivery = await state.sendWebhook('installation', {
          action: 'deleted',
          installation: state.installationPayload(installation),
        });
        return { json: { delivery } };
      },
    },
    {
      method: 'POST',
      path: '/__mock/installations/:id/repositories',
      handler: async (req) => {
        const installation = state.requireInstallation(Number(req.params.id));
        const b = json(req);
        const add = Array.isArray(b.add) ? (b.add as { id: number; name: string; private?: boolean }[]) : [];
        const remove = Array.isArray(b.remove) ? (b.remove as number[]) : [];
        const added = state.addRepos(installation.id, add);
        const removed = state.removeRepos(remove);
        const delivery = await state.sendWebhook('installation_repositories', {
          action: added.length ? 'added' : 'removed',
          installation: state.installationPayload(installation),
          repositories_added: added.map((r) => state.repoPayload(r)),
          repositories_removed: removed.map((r) => ({ id: r.id, full_name: r.fullName })),
        });
        return { json: { delivery } };
      },
    },
    {
      method: 'POST',
      path: '/__mock/installations/:id/:action',
      handler: async ({ params }) => {
        const installation = state.requireInstallation(Number(params.id));
        if (params.action !== 'suspend' && params.action !== 'unsuspend')
          throw new MockError(404, 'Not Found');
        installation.suspendedAt = params.action === 'suspend' ? new Date().toISOString() : null;
        const delivery = await state.sendWebhook('installation', {
          action: params.action,
          installation: state.installationPayload(installation),
        });
        return { json: { delivery } };
      },
    },
    {
      method: 'POST',
      path: '/__mock/repos/:owner/:repo/pulls',
      handler: async (req) => {
        const repo = repoOf(req);
        const b = json(req);
        const pull = state.openPull({
          repoId: repo.id,
          title: str(b.title) ?? 'Update',
          body: str(b.body),
          author: str(b.author),
          authorType: b.authorType === 'Bot' ? 'Bot' : 'User',
          draft: b.draft === true,
          headRef: str(b.headRef),
          baseRef: str(b.baseRef),
          files: fileChanges(state, repo.id, b.files),
        });
        return sendPull('opened', pull);
      },
    },
    {
      method: 'POST',
      path: '/__mock/repos/:owner/:repo/pulls/:number/commits',
      handler: async (req) => {
        const pull = pullOf(req);
        const files = fileChanges(state, pull.repoId, json(req).files);
        state.pushCommit(pull, files);
        return sendPull('synchronize', pull);
      },
    },
    {
      method: 'POST',
      path: '/__mock/repos/:owner/:repo/pulls/:number/close',
      handler: async (req) => {
        const pull = pullOf(req);
        const now = new Date().toISOString();
        pull.state = 'closed';
        pull.closedAt = now;
        if (json(req).merge === true) {
          pull.merged = true;
          pull.mergedAt = now;
        }
        return sendPull('closed', pull);
      },
    },
    {
      method: 'POST',
      path: '/__mock/repos/:owner/:repo/pulls/:number/reopen',
      handler: async (req) => {
        const pull = pullOf(req);
        if (pull.merged) throw new MockError(422, 'A merged pull request cannot be reopened');
        pull.state = 'open';
        pull.closedAt = null;
        return sendPull('reopened', pull);
      },
    },
    {
      method: 'POST',
      path: '/__mock/repos/:owner/:repo/pulls/:number/ready',
      handler: async (req) => {
        const pull = pullOf(req);
        pull.draft = false;
        return sendPull('ready_for_review', pull);
      },
    },
    {
      // A comment by someone else (default "mallory"): with path + line, an inline review comment.
      method: 'POST',
      path: '/__mock/repos/:owner/:repo/pulls/:number/comments',
      handler: (req) => {
        const b = json(req);
        const body = str(b.body);
        if (!body) throw new MockError(422, 'body is required');
        const id = state.addForeignComment(pullOf(req), {
          body,
          ...(str(b.login) ? { login: str(b.login) } : {}),
          ...(str(b.path) ? { path: str(b.path) } : {}),
          ...(typeof b.line === 'number' ? { line: b.line } : {}),
        });
        return { status: 201, json: { id } };
      },
    },
    {
      // The next request to `method path` on the API answers `status` (GitHub outages in tests).
      method: 'POST',
      path: '/__mock/fail',
      handler: (req) => {
        const b = json(req);
        const method = str(b.method);
        const path = str(b.path);
        const status = typeof b.status === 'number' ? b.status : Number(b.status);
        if (!method || !path || !Number.isInteger(status))
          throw new MockError(422, 'method, path and status are required');
        const times = typeof b.times === 'number' ? b.times : 1;
        for (let i = 0; i < times; i++) state.failNext(method, path, status);
        return { status: 201, json: { method, path, status, times } };
      },
    },
    {
      method: 'GET',
      path: '/__mock/repos/:owner/:repo/pulls/:number/activity',
      handler: (req) => {
        const pull = pullOf(req);
        const shas = new Set(pull.commits.map((c) => c.sha));
        return {
          json: {
            headSha: state.head(pull).sha,
            checkRuns: [...state.checkRuns.values()].filter(
              (c) => c.repoId === pull.repoId && shas.has(c.headSha),
            ),
            comments: [...state.issueComments.values()].filter(
              (c) => c.repoId === pull.repoId && c.number === pull.number,
            ),
            reviews: state.reviews.filter((r) => r.repoId === pull.repoId && r.number === pull.number),
            reviewComments: state.reviewComments.filter(
              (c) => c.repoId === pull.repoId && c.number === pull.number,
            ),
            threads: state.reviewThreads(pull),
          },
        };
      },
    },
    {
      // A person reacts to a review comment: {content: "+1" | "-1" | THUMBS_UP | …, login?, remove?}.
      method: 'POST',
      path: '/__mock/repos/:owner/:repo/pulls/:number/comments/:id/reactions',
      handler: (req) => {
        const comment = state.threadComment(pullOf(req), Number(req.params.id));
        const content = reactionContent(str(json(req).content) ?? '');
        if (!content) return { status: 422, json: { message: 'unknown reaction content' } };
        const login = str(json(req).login) ?? 'maya-chen';
        if (json(req).remove === true) state.unreact(comment.id, content, login);
        else state.react(comment.id, content, login);
        return { json: { commentId: comment.id, reactions: state.reactions.get(comment.id) ?? [] } };
      },
    },
    {
      // A person resolves (or, with {resolved: false}, unresolves) the thread a review comment opened.
      method: 'POST',
      path: '/__mock/repos/:owner/:repo/pulls/:number/comments/:id/resolve',
      handler: (req) => {
        const comment = state.threadComment(pullOf(req), Number(req.params.id));
        if (json(req).resolved === false) state.resolvedThreads.delete(comment.id);
        else state.resolvedThreads.set(comment.id, str(json(req).login) ?? 'maya-chen');
        return { json: { commentId: comment.id, resolved: state.resolvedThreads.has(comment.id) } };
      },
    },
  ];
}
