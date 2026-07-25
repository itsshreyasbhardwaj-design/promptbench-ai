import { describe, expect, it, vi } from 'vitest';
import { pool, runBenchmark, summarise } from '@/lib/benchmark/runner';
import { getRubric } from '@/lib/evaluation/rubrics';
import { DEFAULT_COMPLETION_PARAMS, type BenchmarkResultRow } from '@/lib/core/types';

const params = { ...DEFAULT_COMPLETION_PARAMS, maxTokens: 256 };

describe('pool', () => {
  it('runs every item exactly once', async () => {
    const seen: number[] = [];
    await pool([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await pool(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
      },
    );

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('keeps workers busy rather than partitioning up front', async () => {
    // One slow item must not idle the other workers.
    const order: number[] = [];
    await pool([0, 1, 2, 3], 2, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, item === 0 ? 30 : 1));
      order.push(item);
    });
    expect(order[0]).not.toBe(0);
  });

  it('is a no-op for an empty list', async () => {
    const worker = vi.fn();
    await pool([], 4, worker);
    expect(worker).not.toHaveBeenCalled();
  });
});

describe('runBenchmark', () => {
  it('produces one row per model per case', async () => {
    const output = await runBenchmark({
      promptTemplate: 'Answer: {{q}}',
      modelIds: ['openai/gpt-4o-mini', 'groq/llama-3.1-8b-instant'],
      params,
      cases: [{ variables: { q: 'one' } }, { variables: { q: 'two' } }],
    });

    expect(output.rows).toHaveLength(4);
    expect(output.summary.totalRuns).toBe(4);
  });

  it('returns rows in model-then-case order regardless of completion order', async () => {
    const output = await runBenchmark({
      promptTemplate: '{{q}}',
      modelIds: ['groq/llama-3.1-8b-instant', 'deepseek/deepseek-r1'],
      params,
      cases: [{ variables: { q: 'a' } }, { variables: { q: 'b' } }],
    });

    expect(output.rows.map((r) => [r.modelId, r.caseIndex])).toEqual([
      ['groq/llama-3.1-8b-instant', 0],
      ['groq/llama-3.1-8b-instant', 1],
      ['deepseek/deepseek-r1', 0],
      ['deepseek/deepseek-r1', 1],
    ]);
  });

  it('substitutes per-case variables into each prompt', async () => {
    const output = await runBenchmark({
      promptTemplate: 'Define {{term}}',
      modelIds: ['openai/gpt-4o-mini'],
      params,
      cases: [{ variables: { term: 'idempotence' } }],
    });

    expect(output.rows[0]?.completion.content).toContain('idempotence');
  });

  it('reports progress for every dispatched pair', async () => {
    const onProgress = vi.fn();
    await runBenchmark({
      promptTemplate: 'x',
      modelIds: ['openai/gpt-4o-mini', 'groq/llama-3.1-8b-instant'],
      params,
      cases: [{ variables: {} }],
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({ completed: 2, total: 2 });
  });

  it('attaches evaluations when a rubric is supplied', async () => {
    const output = await runBenchmark({
      promptTemplate: 'Explain locking.',
      modelIds: ['openai/gpt-4o-mini'],
      params,
      cases: [{ variables: {} }],
      rubric: getRubric('fast-heuristic')!,
    });

    expect(output.rows[0]?.evaluation).not.toBeNull();
    expect(output.summary.models[0]?.avgScore).not.toBeNull();
  });

  it('leaves evaluations null when no rubric is supplied', async () => {
    const output = await runBenchmark({
      promptTemplate: 'x',
      modelIds: ['openai/gpt-4o-mini'],
      params,
      cases: [{ variables: {} }],
    });

    expect(output.rows[0]?.evaluation).toBeNull();
    expect(output.summary.winnerModelId).toBeNull();
  });

  it('rejects an empty model list', async () => {
    await expect(
      runBenchmark({
        promptTemplate: 'x',
        modelIds: [],
        params,
        cases: [{ variables: {} }],
      }),
    ).rejects.toThrow(/at least one model/i);
  });

  it('rejects an empty case list', async () => {
    await expect(
      runBenchmark({
        promptTemplate: 'x',
        modelIds: ['openai/gpt-4o-mini'],
        params,
        cases: [],
      }),
    ).rejects.toThrow(/at least one case/i);
  });

  it('validates model ids up front rather than partway through a paid run', async () => {
    await expect(
      runBenchmark({
        promptTemplate: 'x',
        modelIds: ['openai/gpt-4o-mini', 'typo/not-real'],
        params,
        cases: [{ variables: {} }],
      }),
    ).rejects.toThrow(/Unknown model/);
  });

  it('enforces the per-run model ceiling', async () => {
    const tooMany = Array.from({ length: 12 }, () => 'openai/gpt-4o-mini');
    await expect(
      runBenchmark({
        promptTemplate: 'x',
        modelIds: tooMany,
        params,
        cases: [{ variables: {} }],
      }),
    ).rejects.toThrow(/at most/i);
  });
});

describe('summarise', () => {
  const row = (
    modelId: string,
    caseIndex: number,
    overrides: {
      latencyMs?: number;
      costUsd?: number;
      score?: number | null;
      error?: boolean;
    } = {},
  ): BenchmarkResultRow => ({
    id: `${modelId}-${caseIndex}`,
    modelId,
    caseIndex,
    variables: {},
    completion: {
      modelId,
      provider: 'openai',
      resolvedModel: modelId,
      content: overrides.error ? '' : 'response',
      usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, totalTokens: 30 },
      cost: {
        inputCostUsd: 0,
        outputCostUsd: 0,
        totalCostUsd: overrides.costUsd ?? 0.001,
      },
      latencyMs: overrides.latencyMs ?? 100,
      timeToFirstTokenMs: 50,
      finishReason: overrides.error ? 'error' : 'stop',
    },
    evaluation:
      overrides.score === undefined || overrides.score === null
        ? null
        : {
            overallScore: overrides.score,
            criteria: [
              {
                criterionId: 'correctness',
                score: overrides.score,
                rationale: '',
                confidence: 1,
              },
            ],
            rubricId: 'r',
            judgeModelId: 'j',
            evaluatedAt: new Date().toISOString(),
          },
  });

  it('returns an empty summary for no rows', () => {
    const summary = summarise([]);
    expect(summary.totalRuns).toBe(0);
    expect(summary.models).toEqual([]);
    expect(summary.winnerModelId).toBeNull();
  });

  it('picks the highest-scoring model as winner', () => {
    const summary = summarise([row('a', 0, { score: 90 }), row('b', 0, { score: 70 })]);
    expect(summary.winnerModelId).toBe('a');
  });

  it('ranks models by score descending', () => {
    const summary = summarise([
      row('low', 0, { score: 60 }),
      row('high', 0, { score: 95 }),
      row('mid', 0, { score: 80 }),
    ]);
    expect(summary.models.map((m) => m.modelId)).toEqual(['high', 'mid', 'low']);
  });

  it('names the cheapest model within five points of the winner as best value', () => {
    const summary = summarise([
      row('expensive', 0, { score: 90, costUsd: 0.1 }),
      row('cheap', 0, { score: 87, costUsd: 0.001 }),
      row('cheapest-but-bad', 0, { score: 40, costUsd: 0.0001 }),
    ]);

    expect(summary.winnerModelId).toBe('expensive');
    expect(summary.bestValueModelId).toBe('cheap');
  });

  it('counts failures without letting them distort latency averages', () => {
    const summary = summarise([
      row('a', 0, { latencyMs: 100 }),
      row('a', 1, { latencyMs: 0, error: true }),
    ]);

    const model = summary.models[0]!;
    expect(model.runs).toBe(2);
    expect(model.failures).toBe(1);
    // Only the successful call contributes to the mean.
    expect(model.avgLatencyMs).toBe(100);
  });

  it('computes p95 latency across a model runs', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row('a', i, { latencyMs: (i + 1) * 100 }),
    );
    const model = summarise(rows).models[0]!;
    expect(model.p95LatencyMs).toBeGreaterThan(model.avgLatencyMs);
  });

  it('sums cost and tokens across every row', () => {
    const summary = summarise([
      row('a', 0, { costUsd: 0.01 }),
      row('a', 1, { costUsd: 0.02 }),
    ]);

    expect(summary.totalCostUsd).toBeCloseTo(0.03, 8);
    expect(summary.totalTokens).toBe(60);
  });

  it('reports a null score when nothing was evaluated', () => {
    expect(summarise([row('a', 0)]).models[0]?.avgScore).toBeNull();
  });

  it('averages criterion scores per model', () => {
    const summary = summarise([row('a', 0, { score: 80 }), row('a', 1, { score: 60 })]);
    expect(summary.models[0]?.criterionAverages.correctness).toBeCloseTo(70, 1);
  });
});
