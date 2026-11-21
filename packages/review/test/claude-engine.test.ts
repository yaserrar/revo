import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_REPO_SETTINGS, type Finding } from '@revo/shared';
import { buildReviewContext } from '../src/context';
import { createClaudeEngine, responseUsage } from '../src/engines/claude';
import { parseFindingsInput, parseVerificationsInput, REPORT_TOOLS } from '../src/engines/tool-schemas';
import { ReviewEngineError } from '../src/errors';
import { SYSTEM_PROMPT } from '../src/prompts';
import type { ChangedFile, EngineContext } from '../src/types';

type Body = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Reply = Partial<Anthropic.Beta.BetaMessage> & { content: Anthropic.Beta.BetaMessage['content'] };

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

const usage = (over: Partial<Anthropic.Beta.BetaUsage> = {}) =>
  ({
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 2000,
    iterations: null,
    ...over,
  }) as Anthropic.Beta.BetaUsage;

const toolUse = (name: string, input: unknown, id = 'toolu_1') =>
  ({
    type: 'tool_use',
    id,
    name,
    input,
    caller: { type: 'direct' },
  }) as unknown as Anthropic.Beta.BetaContentBlock;

const reply = (r: Reply): Anthropic.Beta.BetaMessage =>
  ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    stop_reason: 'tool_use',
    stop_details: null,
    usage: usage(),
    ...r,
  }) as Anthropic.Beta.BetaMessage;

function fakeClient(...replies: (Anthropic.Beta.BetaMessage | Error)[]) {
  const create = vi.fn(async (_body: Body) => {
    const next = replies.shift();
    if (!next) throw new Error('no more replies');
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
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

describe('report tools', () => {
  it('are strict, have no length or range constraints, and list every field as required', () => {
    for (const tool of REPORT_TOOLS) {
      expect(tool.strict).toBe(true);
      const json = JSON.stringify(tool.input_schema);
      expect(json).not.toMatch(/"(minLength|maxLength|minimum|maximum|minItems|maxItems)"/);
      expect(json).not.toContain('9007199254740991');
    }
  });

  it('normalises findings: path prefix, swapped lines, lengths and confidence', () => {
    const result = parseFindingsInput({
      findings: [{ ...modelFinding, lineStart: 9, lineEnd: 4, title: 'x'.repeat(150), confidence: 1.4 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]).toMatchObject({
      file: 'src/lib/pricing.ts',
      lineStart: 4,
      lineEnd: 9,
      confidence: 1,
    });
    expect(result.value[0]!.title).toHaveLength(100);
  });

  it('rejects findings that stay invalid after normalising', () => {
    const result = parseFindingsInput({ findings: [{ ...modelFinding, title: '  ' }] });
    expect(result).toMatchObject({ ok: false });
    expect(parseFindingsInput({ nope: true })).toMatchObject({ ok: false });
  });

  it('needs exactly one verification per index, ignoring extras and duplicates', () => {
    const v = (index: number, outcome = 'confirmed', severity: string | null = null) => ({
      index,
      reason: 'Line 2 adds one.',
      outcome,
      severity,
    });
    const ok = parseVerificationsInput(
      { verifications: [v(1, 'rejected'), v(0, 'confirmed', 'minor'), v(0), v(7)] },
      2,
    );
    expect(ok).toEqual({
      ok: true,
      value: [
        { index: 0, outcome: 'confirmed', reason: 'Line 2 adds one.', severity: 'minor' },
        { index: 1, outcome: 'rejected', reason: 'Line 2 adds one.' },
      ],
    });
    expect(parseVerificationsInput({ verifications: [v(0)] }, 2)).toEqual({
      ok: false,
      problem: 'there is no answer for index 1',
    });
  });
});

describe('createClaudeEngine', () => {
  it('sends a cache-friendly request: same tools, system and context in both passes', async () => {
    const { client, create } = fakeClient(
      reply({ content: [toolUse('report_findings', { findings: [modelFinding] })] }),
      reply({
        content: [
          toolUse('report_verifications', {
            verifications: [{ index: 0, reason: 'Line 2.', outcome: 'confirmed', severity: null }],
          }),
        ],
        usage: usage({ cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 }),
      }),
    );
    const engine = createClaudeEngine({ client, effort: 'medium' });
    const ctx = context('Money is in cents.');
    const found = await engine.find(ctx);
    expect(found.findings).toHaveLength(1);
    expect(found.findings[0]!.file).toBe('src/lib/pricing.ts');
    const verified = await engine.verify(ctx, found.findings);
    expect(verified.verifications).toEqual([{ index: 0, outcome: 'confirmed', reason: 'Line 2.' }]);

    const [first, second] = create.mock.calls.map(([body]) => body);
    expect(first).toMatchObject({
      model: 'claude-sonnet-5-5',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      tool_choice: { type: 'auto' },
    });
    expect(first!.system).toEqual([
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: expect.stringContaining('Money is in cents.') },
    ]);
    const content = (b: Body) => b.messages[0]!.content as Anthropic.Beta.BetaTextBlockParam[];
    expect(content(first!)[0]).toEqual({
      type: 'text',
      text: ctx.context.text,
      cache_control: { type: 'ephemeral' },
    });
    expect(content(first!)[1]!.text).toContain('Pass 1');
    expect(content(second!)[1]!.text).toContain('Pass 2');
    const { messages: _m1, ...prefix1 } = first!;
    const { messages: _m2, ...prefix2 } = second!;
    expect(prefix2).toEqual(prefix1);
    expect(content(second!)[0]).toEqual(content(first!)[0]);

    // Sonnet 5.5: 1000 × $2 + 500 × $10 + 2000 × $2.50 per million.
    expect(found.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 2000,
      costUsd: 0.012,
    });
    expect(verified.usage.cacheReadTokens).toBe(2000);
  });

  it('retries once with the problem named when the answer is invalid', async () => {
    const { client, create } = fakeClient(
      reply({
        content: [
          { type: 'text', text: 'Looks fine.', citations: null },
        ] as Anthropic.Beta.BetaContentBlock[],
        stop_reason: 'end_turn',
      }),
      reply({ content: [toolUse('report_findings', { findings: [] })] }),
    );
    const result = await createClaudeEngine({ client }).find(context());
    expect(result.findings).toEqual([]);
    expect(create).toHaveBeenCalledTimes(2);
    const retryTask = (
      create.mock.calls[1]![0].messages[0]!.content as Anthropic.Beta.BetaTextBlockParam[]
    )[1]!;
    expect(retryTask.text).toContain('you did not call `report_findings`');
    expect(result.usage.inputTokens).toBe(2000);
  });

  it('throws invalid_output after the second invalid answer, with the usage spent', async () => {
    const bad = () =>
      reply({ content: [toolUse('report_findings', { findings: [{ ...modelFinding, explanation: '' }] })] });
    const { client } = fakeClient(bad(), bad());
    const err = await createClaudeEngine({ client })
      .find(context())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewEngineError);
    expect(err).toMatchObject({ code: 'invalid_output', retryable: true, pass: 'find' });
    expect((err as ReviewEngineError).usage?.inputTokens).toBe(2000);
  });

  it('maps refusals and max_tokens to non-retryable errors', async () => {
    const refusal = fakeClient(
      reply({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: null },
      } as unknown as Reply),
    );
    await expect(createClaudeEngine({ client: refusal.client }).find(context())).rejects.toMatchObject({
      code: 'refusal',
      retryable: false,
    });
    const cut = fakeClient(reply({ content: [], stop_reason: 'max_tokens' }));
    await expect(createClaudeEngine({ client: cut.client }).find(context())).rejects.toMatchObject({
      code: 'max_tokens',
      retryable: false,
    });
  });

  it('maps API errors: rate limits and outages retry, auth and bad requests do not', async () => {
    const headers = new Headers();
    const cases: [Error, string, boolean][] = [
      [new Anthropic.RateLimitError(429, undefined, 'slow down', headers), 'rate_limited', true],
      [new Anthropic.InternalServerError(529, undefined, 'overloaded', headers), 'unavailable', true],
      [new Anthropic.APIConnectionError({ message: 'offline' }), 'unavailable', true],
      [new Anthropic.AuthenticationError(401, undefined, 'bad key', headers), 'auth', false],
      [new Anthropic.BadRequestError(400, undefined, 'prompt is too long', headers), 'bad_request', false],
    ];
    for (const [error, code, retryable] of cases) {
      const { client } = fakeClient(error);
      await expect(createClaudeEngine({ client }).find(context())).rejects.toMatchObject({ code, retryable });
    }
  });
});

describe('responseUsage', () => {
  it('prices a fallback iteration at the model that ran it', () => {
    const response = reply({
      content: [],
      model: 'claude-opus-4-8',
      usage: usage({
        input_tokens: 1000,
        output_tokens: 1000,
        cache_creation_input_tokens: 0,
        iterations: [
          {
            type: 'message',
            model: 'claude-sonnet-5-5',
            input_tokens: 1000,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation: null,
          },
          {
            type: 'fallback_message',
            model: 'claude-opus-4-8',
            input_tokens: 0,
            output_tokens: 1000,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation: null,
          },
        ] as unknown as Anthropic.Beta.BetaIterationsUsage,
      }),
    });
    // 1000 × $2 (Sonnet input) + 1000 × $25 (Opus 4.8 output), per million.
    expect(responseUsage(response, 'claude-sonnet-5-5').costUsd).toBe(0.027);
  });
});

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

describe('verify task', () => {
  it('lists the findings with their indexes', async () => {
    const { client, create } = fakeClient(
      reply({
        content: [
          toolUse('report_verifications', {
            verifications: [{ index: 0, reason: 'Real.', outcome: 'confirmed', severity: null }],
          }),
        ],
      }),
    );
    await createClaudeEngine({ client }).verify(context(), [finding]);
    const task = (create.mock.calls[0]![0].messages[0]!.content as Anthropic.Beta.BetaTextBlockParam[])[1]!
      .text;
    expect(task).toContain('"index": 0');
    expect(task).toContain('Off by one');
  });
});
