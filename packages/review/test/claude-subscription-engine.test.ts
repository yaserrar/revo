import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type Anthropic from '@anthropic-ai/sdk';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_REPO_SETTINGS, type Finding } from '@revo/shared';
import { buildReviewContext } from '../src/context';
import { createClaudeEngine } from '../src/engines/claude';
import {
  createClaudeSubscriptionEngine,
  subscriptionEnv,
  type SubscriptionQuery,
} from '../src/engines/claude-subscription';
import { REPORT_INPUT_SCHEMAS } from '../src/engines/tool-schemas';
import { ReviewEngineError } from '../src/errors';
import { renderInstructions, SYSTEM_PROMPT } from '../src/prompts';
import type { ChangedFile, EngineContext } from '../src/types';

const file: ChangedFile = {
  path: 'src/lib/pricing.ts',
  status: 'modified',
  patch: '@@ -1,2 +1,2 @@\n const a = 1;\n-return a;\n+return a + 1;',
  additions: 1,
  deletions: 1,
  newContent: 'const a = 1;\nreturn a + 1;\n',
};

function context(instructions = ''): EngineContext {
  const settings = { ...DEFAULT_REPO_SETTINGS, instructions };
  const pr = { title: 'Pricing', body: '' };
  return {
    pr,
    files: [file],
    related: [],
    settings,
    model: settings.model,
    context: buildReviewContext({ pr, files: [file], related: [], budgetTokens: 10_000 }),
  };
}

const modelFinding = {
  file: './src/lib/pricing.ts',
  lineStart: 2,
  lineEnd: 2,
  category: 'bug',
  title: 'Off by one in the total',
  explanation: 'The total adds one to every order.',
  suggestion: 'Return a.',
  severity: 'major',
  confidence: 0.9,
};

const finding: Finding = {
  category: 'bug',
  severity: 'major',
  file: 'src/lib/pricing.ts',
  lineStart: 2,
  lineEnd: 2,
  title: 'Off by one',
  explanation: 'Adds one.',
  suggestion: 'Return a.',
  confidence: 0.9,
};

const modelUsage = (over: Record<string, number> = {}) => ({
  'claude-sonnet-5-5': {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadInputTokens: 300,
    cacheCreationInputTokens: 2000,
    webSearchRequests: 0,
    costUSD: 0.0123,
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    ...over,
  },
});

/** A finished run, as Claude Code reports it. */
const success = (structured: unknown, over: Record<string, unknown> = {}) =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '',
    stop_reason: 'end_turn',
    num_turns: 1,
    duration_ms: 1000,
    duration_api_ms: 900,
    total_cost_usd: 0.0123,
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: modelUsage(),
    permission_denials: [],
    ...(structured === undefined ? {} : { structured_output: structured }),
    uuid: 'u',
    session_id: 's',
    ...over,
  }) as unknown as SDKMessage;

const errorResult = (subtype: string, errors: string[] = []) =>
  ({
    type: 'result',
    subtype,
    is_error: true,
    stop_reason: null,
    num_turns: 1,
    duration_ms: 10,
    duration_api_ms: 0,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    errors,
    uuid: 'u',
    session_id: 's',
  }) as unknown as SDKMessage;

const assistantError = (error: string) =>
  ({
    type: 'assistant',
    message: { content: [] },
    parent_tool_use_id: null,
    error,
    uuid: 'u',
    session_id: 's',
  }) as unknown as SDKMessage;

type Run = SDKMessage[] | Error | ((options: Options) => AsyncIterable<SDKMessage>);

/** A mock of the SDK's query(): each call plays the next scripted run. */
function fakeQuery(...runs: Run[]) {
  const calls: { prompt: string; options: Options; cwdExisted: boolean }[] = [];
  const query = vi.fn<SubscriptionQuery>(({ prompt, options }) => {
    calls.push({ prompt, options, cwdExisted: existsSync(options.cwd!) });
    const next = runs.shift();
    if (!next) throw new Error('no more runs');
    if (typeof next === 'function') return next(options);
    return (async function* () {
      if (next instanceof Error) throw next;
      yield* next;
    })();
  });
  return { query, calls };
}

const findings = (list: unknown[]) => ({ findings: list });
const confirmed = { verifications: [{ index: 0, reason: 'Line 2.', outcome: 'confirmed', severity: null }] };

describe('createClaudeSubscriptionEngine', () => {
  it('runs Claude Code with the API engine’s prompt and nothing else: no tools, settings or transcript', async () => {
    const { query, calls } = fakeQuery([success(findings([modelFinding]))], [success(confirmed)]);
    const engine = createClaudeSubscriptionEngine({
      query,
      effort: 'medium',
      env: { PATH: '/bin', HOME: '/home/me', ANTHROPIC_API_KEY: 'sk-ant-host' },
    });
    const ctx = context('Money is in cents.');
    const found = await engine.find(ctx);
    const verified = await engine.verify(ctx, found.findings);

    expect(engine.kind).toBe('claude');
    expect(found.findings).toHaveLength(1);
    expect(found.findings[0]!.file).toBe('src/lib/pricing.ts');
    expect(verified.verifications).toEqual([{ index: 0, outcome: 'confirmed', reason: 'Line 2.' }]);

    const [first, second] = calls;
    expect(first!.options).toMatchObject({
      model: 'claude-sonnet-5-5',
      thinking: { type: 'adaptive' },
      effort: 'medium',
      outputFormat: { type: 'json_schema', schema: REPORT_INPUT_SCHEMAS.report_findings },
      tools: [],
      mcpServers: {},
      strictMcpConfig: true,
      settingSources: [],
      skills: [],
      verbatimPrompts: true,
      persistSession: false,
    });
    expect(first!.options.systemPrompt).toBe(
      `${SYSTEM_PROMPT}\n\n${renderInstructions('Money is in cents.')}`,
    );
    expect(second!.options.systemPrompt).toBe(first!.options.systemPrompt);
    expect(second!.options.outputFormat).toEqual({
      type: 'json_schema',
      schema: REPORT_INPUT_SCHEMAS.report_verifications,
    });

    // The subscription pays: no API key reaches Claude Code.
    expect(first!.options.env).toEqual({
      PATH: '/bin',
      HOME: '/home/me',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'revo',
    });

    // A fresh, empty temp folder per run, removed afterwards.
    expect(first!.options.cwd!.startsWith(tmpdir())).toBe(true);
    expect(first!.options.cwd).not.toBe(second!.options.cwd);
    expect(calls.every((c) => c.cwdExisted)).toBe(true);
    expect(calls.some((c) => existsSync(c.options.cwd!))).toBe(false);

    // Context, then the pass's task, then how to answer.
    expect(first!.prompt.startsWith(ctx.context.text)).toBe(true);
    expect(first!.prompt).toContain('Pass 1: find.');
    expect(first!.prompt).toContain('`report_findings` is the StructuredOutput tool');
    expect(second!.prompt).toContain('Pass 2: verify.');
    expect(second!.prompt).toContain('"title": "Off by one in the total"');

    // Tokens are recorded, the cost is $0 (the subscription is not billed per token).
    expect(found.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 300,
      cacheWriteTokens: 2000,
      costUsd: 0,
    });
  });

  it('only lets the model answer: every other tool is refused', async () => {
    const { query, calls } = fakeQuery([success(findings([]))]);
    await createClaudeSubscriptionEngine({ query }).find(context());
    const canUseTool = calls[0]!.options.canUseTool!;
    const signal = new AbortController().signal;
    expect(await canUseTool('StructuredOutput', {}, { signal } as never)).toEqual({ behavior: 'allow' });
    expect(await canUseTool('Bash', { command: 'ls' }, { signal } as never)).toMatchObject({
      behavior: 'deny',
    });
  });

  it('gives the same findings and verifications as the API engine for the same answers', async () => {
    const reply = (name: string, input: unknown) =>
      ({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        stop_reason: 'tool_use',
        stop_details: null,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        content: [{ type: 'tool_use', id: 'toolu_1', name, input }],
      }) as unknown as Anthropic.Beta.BetaMessage;
    const answers = [
      reply('report_findings', findings([modelFinding])),
      reply('report_verifications', confirmed),
    ];
    const client = {
      beta: { messages: { create: vi.fn(async () => answers.shift()) } },
    } as unknown as Anthropic;
    const api = createClaudeEngine({ client });
    const { query } = fakeQuery([success(findings([modelFinding]))], [success(confirmed)]);
    const sub = createClaudeSubscriptionEngine({ query });

    const ctx = context();
    const apiFound = await api.find(ctx);
    const subFound = await sub.find(ctx);
    expect(subFound.findings).toEqual(apiFound.findings);
    expect((await sub.verify(ctx, subFound.findings)).verifications).toEqual(
      (await api.verify(ctx, apiFound.findings)).verifications,
    );
  });

  it('retries once with the problem named when the answer is invalid or missing', async () => {
    const { query, calls } = fakeQuery(
      [success(undefined)],
      [success(findings([{ ...modelFinding, explanation: ' ' }]))],
    );
    const err = await createClaudeSubscriptionEngine({ query })
      .find(context())
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain('you did not call `StructuredOutput`');
    expect(err).toBeInstanceOf(ReviewEngineError);
    expect(err).toMatchObject({ code: 'invalid_output', retryable: true, pass: 'find' });
    expect((err as ReviewEngineError).usage).toMatchObject({ inputTokens: 2000, costUsd: 0 });

    const again = fakeQuery([errorResult('error_max_structured_output_retries')], [success(findings([]))]);
    const result = await createClaudeSubscriptionEngine({ query: again.query }).find(context());
    expect(result.findings).toEqual([]);
    expect(again.calls[1]!.prompt).toContain('the answer did not match the schema');
  });

  it('asks for one answer per finding in pass 2, and retries a missing index', async () => {
    const { query, calls } = fakeQuery([success({ verifications: [] })], [success(confirmed)]);
    const result = await createClaudeSubscriptionEngine({ query }).verify(context(), [finding]);
    expect(result.verifications).toHaveLength(1);
    expect(calls[0]!.prompt).toContain('Off by one');
    expect(calls[1]!.prompt).toContain('there is no answer for index 0');
  });

  it('maps failures: signed out and refusals do not retry, limits and outages do', async () => {
    const cases: [Run, string, boolean, RegExp?][] = [
      [
        [
          assistantError('authentication_failed'),
          success(undefined, { is_error: true, result: 'Not logged in' }),
        ],
        'auth',
        false,
        /\/login/,
      ],
      [
        [success(undefined, { is_error: true, result: 'Unauthorized', api_error_status: 401 })],
        'auth',
        false,
      ],
      [
        [
          {
            type: 'rate_limit_event',
            rate_limit_info: { status: 'rejected' },
            uuid: 'u',
            session_id: 's',
          } as unknown as SDKMessage,
          success(undefined, { is_error: true, result: 'limit' }),
        ],
        'rate_limited',
        true,
        /usage limit/,
      ],
      [
        [assistantError('overloaded'), errorResult('error_during_execution', ['API Error: 529'])],
        'unavailable',
        true,
      ],
      [[success(undefined, { stop_reason: 'refusal' })], 'refusal', false],
      [[assistantError('max_output_tokens'), errorResult('error_during_execution')], 'max_tokens', false],
      [new Error('Claude Code process exited with code 1'), 'unavailable', true],
      [new Error('Invalid API key · Please run /login'), 'auth', false],
      [[], 'unavailable', true, /without a result/],
    ];
    for (const [run, code, retryable, detail] of cases) {
      const { query } = fakeQuery(run);
      const err = await createClaudeSubscriptionEngine({ query })
        .find(context())
        .catch((e: unknown) => e);
      expect(err, code).toBeInstanceOf(ReviewEngineError);
      expect(err).toMatchObject({ code, retryable, pass: 'find' });
      if (detail) expect((err as ReviewEngineError).detail).toMatch(detail);
    }
  });

  it('stops a run that takes too long', async () => {
    const { query } = fakeQuery(
      // Never answers; fails once the engine aborts it, like Claude Code does.
      (options) => ({
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<SDKMessage>>((_, reject) =>
              options.abortController!.signal.addEventListener('abort', () => reject(new Error('aborted'))),
            ),
        }),
      }),
    );
    await expect(
      createClaudeSubscriptionEngine({ query, timeoutMs: 20 }).find(context()),
    ).rejects.toMatchObject({
      code: 'unavailable',
      detail: 'no answer after 0 s',
    });
  });

  it('reports each run for logs, without the prompt', async () => {
    const onCall = vi.fn();
    const { query } = fakeQuery([success(findings([]))]);
    await createClaudeSubscriptionEngine({ query, onCall }).find(context());
    expect(onCall).toHaveBeenCalledWith(
      expect.objectContaining({
        pass: 'find',
        attempt: 1,
        model: 'claude-sonnet-5-5',
        servedBy: 'claude-sonnet-5-5',
        stopReason: 'end_turn',
        usage: expect.objectContaining({ inputTokens: 1000, costUsd: 0 }),
      }),
    );
  });
});

describe('subscriptionEnv', () => {
  it('keeps what Claude Code needs and drops API keys and the host’s secrets', () => {
    expect(
      subscriptionEnv({
        PATH: '/usr/bin',
        HOME: '/Users/me',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
        HTTPS_PROXY: 'http://proxy',
        ANTHROPIC_API_KEY: 'sk-ant-1',
        ANTHROPIC_AUTH_TOKEN: 't',
        AUTH_SECRET: 's',
        TOKEN_ENCRYPTION_KEY: 'k',
        GITHUB_APP_PRIVATE_KEY: 'pem',
        GITHUB_CLIENT_SECRET: 'c',
        GITHUB_WEBHOOK_SECRET: 'w',
        DATABASE_URL: 'postgres://u:p@h/db',
        REDIS_URL: 'redis://h',
        PGPASSWORD: 'p',
      }),
    ).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      HTTPS_PROXY: 'http://proxy',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'revo',
    });
  });
});
