import { describe, expect, it } from 'vitest';
import { buildSnapshot, percentChange } from '@/lib/services/analytics';
import type { RunResultRecord } from '@/lib/db/models';
import type { EvaluationResult } from '@/lib/core/types';

/**
 * Analytics aggregation.
 *
 * `buildSnapshot` is pure over result rows, so it is tested directly rather
 * than through a repository. Everything the dashboard, leaderboard and radar
 * render comes out of this one function.
 */

const DAY = 24 * 60 * 60 * 1000;

function evaluation(
  score: number,
  criteria: Record<string, number> = {},
): EvaluationResult {
  return {
    overallScore: score,
    criteria: Object.entries(criteria).map(([criterionId, value]) => ({
      criterionId: criterionId as EvaluationResult['criteria'][number]['criterionId'],
      score: value,
      rationale: '',
      confidence: 1,
    })),
    rubricId: 'general-quality',
    judgeModelId: 'openai/gpt-4o-mini',
    evaluatedAt: new Date().toISOString(),
  };
}

function result(overrides: {
  modelId: string;
  caseIndex?: number;
  daysAgo?: number;
  latencyMs?: number;
  costUsd?: number;
  tokens?: number;
  score?: number;
  criteria?: Record<string, number>;
  inputTokens?: number;
  outputTokens?: number;
}): RunResultRecord {
  const createdAt = new Date(Date.now() - (overrides.daysAgo ?? 0) * DAY).toISOString();
  const inputTokens = overrides.inputTokens ?? 100;
  const outputTokens = overrides.outputTokens ?? 200;

  return {
    id: `${overrides.modelId}-${overrides.caseIndex ?? 0}-${overrides.daysAgo ?? 0}`,
    runId: 'run_1',
    workspaceId: 'ws_1',
    modelId: overrides.modelId,
    caseIndex: overrides.caseIndex ?? 0,
    variables: {},
    completion: {
      modelId: overrides.modelId,
      provider: 'openai',
      resolvedModel: overrides.modelId,
      content: 'response',
      usage: {
        inputTokens,
        outputTokens,
        cachedInputTokens: 0,
        totalTokens: inputTokens + outputTokens,
      },
      cost: {
        inputCostUsd: 0,
        outputCostUsd: 0,
        totalCostUsd: overrides.costUsd ?? 0.001,
      },
      latencyMs: overrides.latencyMs ?? 500,
      timeToFirstTokenMs: 100,
      finishReason: 'stop',
    },
    evaluation:
      overrides.score === undefined
        ? null
        : evaluation(overrides.score, overrides.criteria ?? {}),
    score: overrides.score ?? null,
    latencyMs: overrides.latencyMs ?? 500,
    costUsd: overrides.costUsd ?? 0.001,
    totalTokens: overrides.tokens ?? inputTokens + outputTokens,
    createdAt,
  };
}

describe('percentChange', () => {
  it('computes a signed percentage', () => {
    expect(percentChange(100, 150)).toBe(50);
    expect(percentChange(100, 50)).toBe(-50);
    expect(percentChange(100, 100)).toBe(0);
  });

  it('returns null with no baseline', () => {
    // Reporting "+100%" against zero prior activity is noise, not information.
    expect(percentChange(0, 42)).toBeNull();
  });
});

describe('buildSnapshot overview', () => {
  it('returns an empty snapshot for no rows', () => {
    const snapshot = buildSnapshot([]);

    expect(snapshot.overview.totalRuns).toBe(0);
    expect(snapshot.overview.avgScore).toBeNull();
    expect(snapshot.leaderboard).toEqual([]);
  });

  it('totals runs, cost and tokens across the window', () => {
    const snapshot = buildSnapshot([
      result({ modelId: 'a', costUsd: 0.01, tokens: 300 }),
      result({ modelId: 'b', caseIndex: 1, costUsd: 0.02, tokens: 500 }),
    ]);

    expect(snapshot.overview.totalRuns).toBe(2);
    expect(snapshot.overview.totalCostUsd).toBeCloseTo(0.03, 8);
    expect(snapshot.overview.totalTokens).toBe(800);
    expect(snapshot.overview.modelsEvaluated).toBe(2);
  });

  it('excludes rows older than the window', () => {
    const snapshot = buildSnapshot(
      [result({ modelId: 'a', daysAgo: 1 }), result({ modelId: 'a', daysAgo: 45 })],
      30,
    );
    expect(snapshot.overview.totalRuns).toBe(1);
  });

  it('compares against the preceding period of equal length', () => {
    const snapshot = buildSnapshot(
      [
        // Current window: two rows.
        result({ modelId: 'a', daysAgo: 1 }),
        result({ modelId: 'a', caseIndex: 1, daysAgo: 2 }),
        // Previous window: one row.
        result({ modelId: 'a', caseIndex: 2, daysAgo: 35 }),
      ],
      30,
    );

    expect(snapshot.overview.totalRuns).toBe(2);
    expect(snapshot.overview.trend.runs).toBe(100);
  });

  it('reports a null trend when there is no prior period', () => {
    const snapshot = buildSnapshot([result({ modelId: 'a', daysAgo: 1 })], 30);
    expect(snapshot.overview.trend.runs).toBeNull();
  });

  it('averages only evaluated rows for the headline score', () => {
    const snapshot = buildSnapshot([
      result({ modelId: 'a', score: 80 }),
      result({ modelId: 'b', caseIndex: 1 }),
    ]);
    expect(snapshot.overview.avgScore).toBe(80);
  });
});

describe('buildSnapshot leaderboard', () => {
  it('ranks by score descending', () => {
    const snapshot = buildSnapshot([
      result({ modelId: 'low', score: 60 }),
      result({ modelId: 'high', score: 95 }),
      result({ modelId: 'mid', score: 78 }),
    ]);

    expect(snapshot.leaderboard.map((e) => e.modelId)).toEqual(['high', 'mid', 'low']);
    expect(snapshot.leaderboard[0]?.rank).toBe(1);
    expect(snapshot.leaderboard[2]?.rank).toBe(3);
  });

  it('breaks a score tie with the faster model', () => {
    const snapshot = buildSnapshot([
      result({ modelId: 'slow', score: 80, latencyMs: 2000 }),
      result({ modelId: 'fast', score: 80, latencyMs: 200 }),
    ]);
    expect(snapshot.leaderboard[0]?.modelId).toBe('fast');
  });

  it('computes head-to-head win rates on shared cases', () => {
    const snapshot = buildSnapshot([
      result({ modelId: 'a', caseIndex: 0, score: 90 }),
      result({ modelId: 'b', caseIndex: 0, score: 60 }),
    ]);

    const a = snapshot.leaderboard.find((e) => e.modelId === 'a');
    expect(a?.winRate).toBe(1);
  });

  it('computes p95 latency alongside the mean', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      result({ modelId: 'a', caseIndex: i, latencyMs: (i + 1) * 100 }),
    );
    const entry = buildSnapshot(rows).leaderboard[0]!;

    expect(entry.avgLatencyMs).toBeGreaterThan(0);
    expect(entry.p95LatencyMs).toBeGreaterThan(entry.avgLatencyMs);
  });

  it('reports score per cent spent as a value metric', () => {
    const snapshot = buildSnapshot([
      result({ modelId: 'cheap', score: 80, costUsd: 0.001 }),
      result({ modelId: 'pricey', score: 85, costUsd: 0.1 }),
    ]);

    const cheap = snapshot.leaderboard.find((e) => e.modelId === 'cheap')!;
    const pricey = snapshot.leaderboard.find((e) => e.modelId === 'pricey')!;

    // Slightly lower quality at a hundredth of the price is far better value.
    expect(cheap.valueScore!).toBeGreaterThan(pricey.valueScore!);
  });

  it('reports a null value score for a zero-cost model rather than Infinity', () => {
    const snapshot = buildSnapshot([result({ modelId: 'free', score: 70, costUsd: 0 })]);
    expect(snapshot.leaderboard[0]?.valueScore).toBeNull();
  });

  it('averages per-criterion scores', () => {
    const snapshot = buildSnapshot([
      result({ modelId: 'a', caseIndex: 0, score: 80, criteria: { correctness: 90 } }),
      result({ modelId: 'a', caseIndex: 1, score: 70, criteria: { correctness: 70 } }),
    ]);

    expect(snapshot.leaderboard[0]?.criterionAverages.correctness).toBe(80);
  });

  it('resolves display names from the catalog', () => {
    const snapshot = buildSnapshot([
      result({ modelId: 'openai/gpt-4o-mini', score: 80 }),
    ]);

    expect(snapshot.leaderboard[0]?.modelName).toBe('GPT-4o mini');
    expect(snapshot.leaderboard[0]?.providerLabel).toBe('OpenAI');
  });

  it('falls back to the raw id for a model outside the catalog', () => {
    const snapshot = buildSnapshot([result({ modelId: 'custom/unknown', score: 80 })]);
    expect(snapshot.leaderboard[0]?.modelName).toBe('custom/unknown');
  });
});

describe('buildSnapshot time series', () => {
  it('emits one point per day in the window, including empty days', () => {
    // Gaps must render as zero rather than being skipped, or the trend line
    // misrepresents its own shape.
    const snapshot = buildSnapshot([result({ modelId: 'a', daysAgo: 2 })], 7);

    expect(snapshot.timeSeries).toHaveLength(7);
    expect(snapshot.timeSeries.filter((p) => p.runs === 0)).toHaveLength(6);
  });

  it('orders points oldest to newest', () => {
    const dates = buildSnapshot([], 5).timeSeries.map((p) => p.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('reports a null score for a day with no evaluations', () => {
    const snapshot = buildSnapshot([result({ modelId: 'a', daysAgo: 0 })], 3);
    expect(snapshot.timeSeries.at(-1)?.avgScore).toBeNull();
  });
});

describe('buildSnapshot breakdowns', () => {
  it('splits input and output tokens per model', () => {
    const snapshot = buildSnapshot([
      result({ modelId: 'a', inputTokens: 300, outputTokens: 700 }),
    ]);

    expect(snapshot.tokensByModel[0]).toMatchObject({ input: 300, output: 700 });
  });

  it('reports cost and latency per model', () => {
    const snapshot = buildSnapshot([
      result({ modelId: 'a', costUsd: 0.05, latencyMs: 800 }),
      result({ modelId: 'b', caseIndex: 1, costUsd: 0.01, latencyMs: 200 }),
    ]);

    expect(snapshot.costByModel).toHaveLength(2);
    expect(snapshot.latencyByModel.find((m) => m.modelId === 'b')?.avgMs).toBe(200);
  });

  it('pivots criterion scores into radar rows keyed by model', () => {
    const snapshot = buildSnapshot([
      result({
        modelId: 'a',
        score: 80,
        criteria: { correctness: 90, safety: 70, readability: 60 },
      }),
      result({
        modelId: 'b',
        caseIndex: 1,
        score: 75,
        criteria: { correctness: 60, safety: 95, readability: 80 },
      }),
    ]);

    expect(snapshot.radar).toHaveLength(3);
    expect(snapshot.radarModels).toHaveLength(2);

    const correctness = snapshot.radar.find((r) => r.criterion === 'correctness')!;
    expect(correctness.a).toBe(90);
    expect(correctness.b).toBe(60);
    expect(correctness.label).toBe('Correctness');
  });

  it('caps the radar at five models to stay readable', () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      result({ modelId: `m${i}`, caseIndex: i, score: 70, criteria: { safety: 80 } }),
    );
    expect(buildSnapshot(rows).radarModels.length).toBeLessThanOrEqual(5);
  });

  it('produces no radar rows when nothing was evaluated', () => {
    expect(buildSnapshot([result({ modelId: 'a' })]).radar).toEqual([]);
  });
});
