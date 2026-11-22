import { createHash, createHmac, randomUUID } from 'node:crypto';
import { DEMO_ACCESS, DEMO_INSTALLATION, DEMO_PERMISSION, DEMO_REPOS, DEMO_USER } from '@revo/db/fixtures';
import { unifiedPatch } from './line-diff';

/**
 * In-memory GitHub App world for the mock: installations, repos, pull
 * requests with commits, check runs, issue comments, PR reviews and review
 * comments. Deterministic: ids and SHAs come from counters and content hashes
 * (webhook delivery ids are random GUIDs, like GitHub's).
 */

export type MockAccount = { id: number; login: string; type: 'User' | 'Organization' };
export type MockRepo = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  installationId: number;
};
export type MockInstallation = { id: number; account: MockAccount; suspendedAt: string | null };

/** A file in a PR: `before` is its content on the base branch (null = added), `after` at the head (null = removed). */
export type MockFileChange = { path: string; before: string | null; after: string | null };
type MockCommit = { sha: string; files: Map<string, MockFileChange> };

export type MockPull = {
  id: number;
  number: number;
  repoId: number;
  title: string;
  body: string;
  author: { login: string; type: 'User' | 'Bot' };
  draft: boolean;
  state: 'open' | 'closed';
  merged: boolean;
  baseRef: string;
  headRef: string;
  commits: MockCommit[];
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
};

export type MockCheckRun = {
  id: number;
  repoId: number;
  name: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  title: string;
  summary: string;
  detailsUrl: string | null;
  /** Every status/conclusion/title the check went through, in order. */
  history: { status: string; conclusion: string | null; title: string }[];
};

export type MockIssueComment = {
  id: number;
  repoId: number;
  number: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  /** How many times the body was edited. */
  edits: number;
  /** Someone other than the App wrote it (absent: the App's bot). */
  author?: MockCommentAuthor;
};

/** A GitHub user who comments on a PR (tests of forged Revo markers). */
export type MockCommentAuthor = { login: string; id: number; type: 'User' | 'Bot' };

export type MockReview = {
  id: number;
  repoId: number;
  number: number;
  commitId: string;
  event: string;
  body: string;
};

export type MockReviewComment = {
  /** Someone other than the App wrote it (absent: the App's bot). */
  author?: MockCommentAuthor;
  id: number;
  reviewId: number;
  repoId: number;
  number: number;
  commitId: string;
  path: string;
  line: number;
  startLine: number | null;
  side: string;
  body: string;
};

export type WebhookTarget = { url: string; secret: string };
export type WebhookDelivery = { id: string; event: string; action: string | null; status: number | null };

export const MOCK_APP_ID = 1;
export const MOCK_APP_SLUG = 'revo-dev';
const BOT = { login: `${MOCK_APP_SLUG}[bot]`, id: 90_000_001, type: 'Bot' };
/** Mock PR numbers start here so they never collide with seeded PRs. */
const FIRST_PR_NUMBER = 1000;

/** Files every demo repo has on its default branch (context for related-file lookup). */
const DEMO_BASE_FILES: Record<string, string> = {
  'tsconfig.json':
    '{\n  "compilerOptions": {\n    "strict": true,\n    "paths": { "~/*": ["./src/*"] }\n  }\n}\n',
  'src/lib/money.ts':
    'export function roundCents(value: number): number {\n  return Math.round(value * 100) / 100;\n}\n',
};

export class MockAppState {
  readonly installations = new Map<number, MockInstallation>();
  readonly repos = new Map<number, MockRepo>();
  readonly pulls: MockPull[] = [];
  readonly checkRuns = new Map<number, MockCheckRun>();
  readonly issueComments = new Map<number, MockIssueComment>();
  readonly reviews: MockReview[] = [];
  readonly reviewComments: MockReviewComment[] = [];
  readonly deliveries: WebhookDelivery[] = [];
  /** Logins that can see every repo of a (non-demo) installation, by installation id. */
  private readonly members = new Map<number, Set<string>>();
  /** Files on each repo's default branch, by repo id. */
  private readonly baseFiles = new Map<number, Map<string, string>>();
  private readonly tokens = new Map<string, number>();
  private nextId = 1;
  webhookTarget: WebhookTarget | null = null;

  constructor(readonly baseUrl: string) {
    this.addInstallation({
      id: DEMO_INSTALLATION.githubId,
      account: { id: 71_000_001, login: DEMO_INSTALLATION.accountLogin, type: DEMO_INSTALLATION.accountType },
      repos: DEMO_REPOS.map((r) => ({ id: r.githubId, name: r.name, private: r.private })),
    });
    for (const r of DEMO_REPOS) this.setBaseFiles(r.githubId, DEMO_BASE_FILES);
  }

  private id(): number {
    return this.nextId++;
  }

  // ── Installations and repos ───────────────────────────────────────────────

  /**
   * `members` are the logins that see the installation's repos on GitHub
   * (default: the demo user). The demo installation uses DEMO_ACCESS instead.
   */
  addInstallation(input: {
    id: number;
    account: MockAccount;
    repos: { id: number; name: string; private?: boolean }[];
    members?: string[];
  }): MockInstallation {
    const installation: MockInstallation = { id: input.id, account: input.account, suspendedAt: null };
    this.installations.set(input.id, installation);
    this.members.set(input.id, new Set(input.members ?? [DEMO_USER.login]));
    this.addRepos(input.id, input.repos);
    return installation;
  }

  addRepos(installationId: number, repos: { id: number; name: string; private?: boolean }[]): MockRepo[] {
    const installation = this.requireInstallation(installationId);
    return repos.map((r) => {
      const repo: MockRepo = {
        id: r.id,
        name: r.name,
        fullName: `${installation.account.login}/${r.name}`,
        private: r.private ?? true,
        installationId,
      };
      this.repos.set(r.id, repo);
      return repo;
    });
  }

  removeRepos(ids: number[]): MockRepo[] {
    const removed = ids.flatMap((id) => {
      const repo = this.repos.get(id);
      return repo ? [repo] : [];
    });
    for (const r of removed) this.repos.delete(r.id);
    return removed;
  }

  removeInstallation(id: number): { installation: MockInstallation; repos: MockRepo[] } {
    const installation = this.requireInstallation(id);
    const repos = this.reposOf(id);
    this.removeRepos(repos.map((r) => r.id));
    this.installations.delete(id);
    this.members.delete(id);
    return { installation, repos };
  }

  reposOf(installationId: number): MockRepo[] {
    return [...this.repos.values()].filter((r) => r.installationId === installationId);
  }

  /** Repos of an installation that a user can see (GET /user/installations/:id/repositories). */
  reposVisibleTo(user: { githubId: number; login: string }, installationId: number): MockRepo[] {
    const repos = this.reposOf(installationId);
    if (installationId === DEMO_INSTALLATION.githubId) {
      const allowed = new Set(DEMO_ACCESS[user.githubId] ?? []);
      return repos.filter((r) => allowed.has(r.id));
    }
    return this.members.get(installationId)?.has(user.login) ? repos : [];
  }

  /**
   * The user's GitHub `permissions` on an installation's repos: demo users as
   * in the seed (Maya admin, Jonas read-only), members of other installations admin.
   */
  permissionsOf(user: { githubId: number }, installationId: number) {
    const role =
      installationId === DEMO_INSTALLATION.githubId ? (DEMO_PERMISSION[user.githubId] ?? 'read') : 'admin';
    const rank = ['read', 'triage', 'write', 'maintain', 'admin'].indexOf(role);
    return { admin: rank >= 4, maintain: rank >= 3, push: rank >= 2, triage: rank >= 1, pull: true };
  }

  /** Installations where a user sees at least one repo (GET /user/installations). */
  installationsVisibleTo(user: { githubId: number; login: string }): MockInstallation[] {
    return [...this.installations.values()].filter((i) => this.reposVisibleTo(user, i.id).length > 0);
  }

  requireInstallation(id: number): MockInstallation {
    const installation = this.installations.get(id);
    if (!installation) throw new MockError(404, `Unknown installation ${id}`);
    return installation;
  }

  repoByName(owner: string, name: string): MockRepo | undefined {
    const fullName = `${owner}/${name}`.toLowerCase();
    return [...this.repos.values()].find((r) => r.fullName.toLowerCase() === fullName);
  }

  setBaseFiles(repoId: number, files: Record<string, string>): void {
    const map = this.baseFiles.get(repoId) ?? new Map<string, string>();
    for (const [path, content] of Object.entries(files)) map.set(path, content);
    this.baseFiles.set(repoId, map);
  }

  // ── Installation tokens ───────────────────────────────────────────────────

  issueInstallationToken(installationId: number): { token: string; expiresAt: string } {
    this.requireInstallation(installationId);
    const token = `ghs_mock_${createHash('sha256').update(`${installationId}:${this.id()}`).digest('hex').slice(0, 32)}`;
    this.tokens.set(token, installationId);
    return { token, expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  }

  /** Installation id behind a token, or null. */
  installationForToken(token: string | null): number | null {
    return token ? (this.tokens.get(token) ?? null) : null;
  }

  // ── Pull requests ─────────────────────────────────────────────────────────

  private commitSha(repoId: number, number: number, files: Map<string, MockFileChange>, seq: number): string {
    const hash = createHash('sha1').update(`${repoId}:${number}:${seq}`);
    for (const [path, f] of [...files].sort(([a], [b]) => a.localeCompare(b)))
      hash.update(`\0${path}\0${f.before ?? '\u0001'}\0${f.after ?? '\u0001'}`);
    return hash.digest('hex');
  }

  openPull(input: {
    repoId: number;
    title: string;
    body?: string;
    author?: string;
    authorType?: 'User' | 'Bot';
    draft?: boolean;
    headRef?: string;
    baseRef?: string;
    files: MockFileChange[];
  }): MockPull {
    if (!this.repos.has(input.repoId)) throw new MockError(404, `Unknown repo ${input.repoId}`);
    const number = FIRST_PR_NUMBER + this.pulls.filter((p) => p.repoId === input.repoId).length;
    const files = new Map(input.files.map((f) => [f.path, f]));
    const pull: MockPull = {
      id: 80_000_000 + this.id(),
      number,
      repoId: input.repoId,
      title: input.title,
      body: input.body ?? '',
      author: { login: input.author ?? 'maya-chen', type: input.authorType ?? 'User' },
      draft: input.draft ?? false,
      state: 'open',
      merged: false,
      baseRef: input.baseRef ?? 'main',
      headRef: input.headRef ?? `feature/pr-${number}`,
      commits: [{ sha: this.commitSha(input.repoId, number, files, 0), files }],
      createdAt: new Date().toISOString(),
      mergedAt: null,
      closedAt: null,
    };
    this.pulls.push(pull);
    return pull;
  }

  /** A new commit on the PR branch: replaces the head version of the given files. */
  pushCommit(pull: MockPull, changes: { path: string; after: string | null }[]): string {
    const files = new Map(this.head(pull).files);
    for (const c of changes) {
      const prev = files.get(c.path);
      const before = prev ? prev.before : (this.baseFiles.get(pull.repoId)?.get(c.path) ?? null);
      files.set(c.path, { path: c.path, before, after: c.after });
    }
    const sha = this.commitSha(pull.repoId, pull.number, files, pull.commits.length);
    pull.commits.push({ sha, files });
    return sha;
  }

  head(pull: MockPull): MockCommit {
    return pull.commits.at(-1)!;
  }

  findPull(repoId: number, number: number): MockPull {
    const pull = this.pulls.find((p) => p.repoId === repoId && p.number === number);
    if (!pull) throw new MockError(404, 'Not Found');
    return pull;
  }

  /** The PR files GitHub lists (changed vs base), with patches. */
  pullFiles(pull: MockPull) {
    return [...this.head(pull).files.values()]
      .map((f) => ({ ...f, diff: unifiedPatch(f.before, f.after) }))
      .filter((f) => f.diff.patch !== '' || f.before !== f.after)
      .map((f) => ({
        filename: f.path,
        status: f.before === null ? 'added' : f.after === null ? 'removed' : 'modified',
        additions: f.diff.additions,
        deletions: f.diff.deletions,
        changes: f.diff.additions + f.diff.deletions,
        patch: f.diff.patch,
        sha: createHash('sha1')
          .update(f.after ?? '')
          .digest('hex'),
      }));
  }

  /** Content of a path at a commit SHA of any PR of the repo (or the base branch), or null. */
  contentAt(repoId: number, path: string, ref: string): string | null {
    for (const pull of this.pulls.filter((p) => p.repoId === repoId)) {
      const commit = pull.commits.find((c) => c.sha === ref);
      if (commit) {
        const change = commit.files.get(path);
        if (change) return change.after;
        break;
      }
    }
    return this.baseFiles.get(repoId)?.get(path) ?? null;
  }

  /**
   * GitHub's commit comparison between two commits of one PR branch: `ahead`
   * when head comes later, with the files whose content differs. Null when
   * either commit is unknown (as after a force-push).
   */
  compare(repoId: number, base: string, head: string) {
    for (const pull of this.pulls.filter((p) => p.repoId === repoId)) {
      const from = pull.commits.findIndex((c) => c.sha === base);
      const to = pull.commits.findIndex((c) => c.sha === head);
      if (from === -1 || to === -1) continue;
      const status = from === to ? 'identical' : from < to ? 'ahead' : 'behind';
      const paths = new Set([...pull.commits[from]!.files.keys(), ...pull.commits[to]!.files.keys()]);
      const files = [...paths].sort().flatMap((path) => {
        const before = this.contentAt(repoId, path, base);
        const after = this.contentAt(repoId, path, head);
        if (before === after) return [];
        const diff = unifiedPatch(before, after);
        return [
          {
            filename: path,
            status: before === null ? 'added' : after === null ? 'removed' : 'modified',
            additions: diff.additions,
            deletions: diff.deletions,
            changes: diff.additions + diff.deletions,
            patch: diff.patch,
          },
        ];
      });
      const commits = pull.commits.slice(from + 1, to + 1).map((c, i) => ({
        sha: c.sha,
        parents: [{ sha: pull.commits[from + i]!.sha }, ...(this.mergeCommits.has(c.sha) ? [{ sha: 'b'.repeat(40) }] : [])],
      }));
      return {
        status,
        ahead_by: Math.max(0, to - from),
        behind_by: Math.max(0, from - to),
        total_commits: commits.length,
        commits,
        files,
      };
    }
    return null;
  }

  /** Commits pushed as merges (two parents), e.g. "Update branch" bringing the base branch in. */
  readonly mergeCommits = new Set<string>();

  /** Code search, like GitHub's: default-branch (base) files containing the term. */
  searchCode(repoId: number, term: string): string[] {
    const files = this.baseFiles.get(repoId) ?? new Map<string, string>();
    return [...files].filter(([, content]) => content.includes(term)).map(([path]) => path);
  }

  // ── Checks, comments, reviews ─────────────────────────────────────────────

  nextObjectId(): number {
    return 10_000_000 + this.id();
  }

  /** Lines of the head version a review comment may target: added or context lines of the patch. */
  commentableLines(pull: MockPull, path: string): Set<number> {
    const file = this.pullFiles(pull).find((f) => f.filename === path);
    const lines = new Set<number>();
    if (!file) return lines;
    let newLine = 0;
    for (const raw of file.patch.split('\n')) {
      const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (header) {
        newLine = Number(header[1]);
        continue;
      }
      if (raw.startsWith('-')) continue;
      lines.add(newLine++);
    }
    return lines;
  }

  get bot() {
    return BOT;
  }

  private readonly failures: { method: string; path: string; status: number }[] = [];

  /** The next `method path` request answers `status` instead (tests of GitHub failures). */
  failNext(method: string, path: string, status: number): void {
    this.failures.push({ method: method.toUpperCase(), path, status });
  }

  /** Consumes an injected failure for this request, if one is pending. */
  takeFailure(method: string, path: string): number | null {
    const i = this.failures.findIndex((f) => f.method === method && f.path === path);
    if (i < 0) return null;
    return this.failures.splice(i, 1)[0]!.status;
  }

  /**
   * A comment by someone other than the App (default "mallory"): an issue
   * comment, or an inline review comment when `path` and `line` are given.
   */
  addForeignComment(
    pull: MockPull,
    input: { body: string; login?: string; path?: string; line?: number },
  ): number {
    const login = input.login ?? 'mallory';
    const author: MockCommentAuthor = { login, id: 70_000_000 + login.length, type: 'User' };
    const id = this.nextObjectId();
    if (input.path && input.line !== undefined) {
      this.reviewComments.push({
        author,
        id,
        reviewId: 0,
        repoId: pull.repoId,
        number: pull.number,
        commitId: this.head(pull).sha,
        path: input.path,
        line: input.line,
        startLine: null,
        side: 'RIGHT',
        body: input.body,
      });
    } else {
      const now = new Date().toISOString();
      this.issueComments.set(id, {
        id,
        repoId: pull.repoId,
        number: pull.number,
        body: input.body,
        createdAt: now,
        updatedAt: now,
        edits: 0,
        author,
      });
    }
    return id;
  }

  // ── Webhooks ──────────────────────────────────────────────────────────────

  /** A signed webhook request exactly as GitHub sends it. */
  webhookRequest(event: string, payload: Record<string, unknown>, secret: string) {
    // Random like GitHub's GUIDs: Revo stores every delivery id, so ids must
    // stay unique across mock restarts.
    const id = randomUUID();
    const body = JSON.stringify(payload);
    return {
      id,
      body,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'GitHub-Hookshot/mock',
        'x-github-event': event,
        'x-github-delivery': id,
        'x-github-hook-installation-target-id': String(MOCK_APP_ID),
        'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
    };
  }

  /** Sends a webhook to the configured target. Returns null when no target is set. */
  async sendWebhook(event: string, payload: Record<string, unknown>): Promise<WebhookDelivery | null> {
    if (!this.webhookTarget) return null;
    const req = this.webhookRequest(event, payload, this.webhookTarget.secret);
    const delivery: WebhookDelivery = {
      id: req.id,
      event,
      action: typeof payload.action === 'string' ? payload.action : null,
      status: null,
    };
    try {
      const res = await fetch(this.webhookTarget.url, {
        method: 'POST',
        headers: req.headers,
        body: req.body,
      });
      delivery.status = res.status;
    } catch {
      delivery.status = 0;
    }
    this.deliveries.push(delivery);
    return delivery;
  }

  // ── Payload builders (shapes GitHub sends, fields Revo reads) ─────────────

  accountPayload(account: MockAccount) {
    return {
      id: account.id,
      login: account.login,
      type: account.type,
      avatar_url: `${this.baseUrl}/avatars/${account.login}.svg`,
    };
  }

  installationPayload(installation: MockInstallation) {
    return {
      id: installation.id,
      app_id: MOCK_APP_ID,
      account: this.accountPayload(installation.account),
      suspended_at: installation.suspendedAt,
    };
  }

  repoPayload(repo: MockRepo) {
    const installation = this.requireInstallation(repo.installationId);
    return {
      id: repo.id,
      name: repo.name,
      full_name: repo.fullName,
      private: repo.private,
      owner: this.accountPayload(installation.account),
    };
  }

  pullPayload(pull: MockPull) {
    const repo = this.repos.get(pull.repoId)!;
    const files = this.pullFiles(pull);
    return {
      id: pull.id,
      number: pull.number,
      title: pull.title,
      body: pull.body || null,
      html_url: `https://github.com/${repo.fullName}/pull/${pull.number}`,
      draft: pull.draft,
      state: pull.state,
      merged: pull.merged,
      merged_at: pull.mergedAt,
      closed_at: pull.closedAt,
      created_at: pull.createdAt,
      updated_at: new Date().toISOString(),
      user: {
        id: 60_000_000 + pull.author.login.length,
        login: pull.author.login,
        type: pull.author.type,
        avatar_url: `${this.baseUrl}/avatars/${pull.author.login.replace(/\[bot\]$/, '')}.svg`,
      },
      head: { ref: pull.headRef, sha: this.head(pull).sha },
      base: { ref: pull.baseRef },
      changed_files: files.length,
      additions: files.reduce((s, f) => s + f.additions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
    };
  }

  pullRequestEvent(action: string, pull: MockPull) {
    const repo = this.repos.get(pull.repoId)!;
    return {
      action,
      number: pull.number,
      pull_request: this.pullPayload(pull),
      repository: this.repoPayload(repo),
      installation: { id: repo.installationId },
      sender: { login: pull.author.login },
    };
  }
}

/** Thrown by state methods; routes turn it into a GitHub-style error response. */
export class MockError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
