import { AppError } from '@/lib/core/errors';
import type {
  BenchmarkResultRow,
  BenchmarkSummary,
  CompletionParams,
  CompletionResult,
  CriterionId,
  ModelAggregate,
  Rubric,
} from '@/lib/core/types';
import { requireModel } from '@/lib/models/catalog';
import { resolveProvider } from '@/lib/providers/registry';
import { renderTemplate } from '@/lib/prompts/template';
import { computeWinRates, evaluate, mean, percentile } from '@/lib/evaluation/engine';
import { serverEnv } from '@/lib/env';
import { newId } from '@/lib/core/id';

export interface BenchmarkCase {
  /** Variables substituted into the prompt template for this case. */
  variables: Record<string, string>;
  /** Optional ground-truth answer, passed to the judge when present. */
  expected?: string;
}

export interface BenchmarkRunInput {
  promptTemplate: string;
  systemPrompt?: string;
  modelIds: string[];
  params: CompletionParams;
  cases: BenchmarkCase[];
  /** When omitted, responses are collected but not scored. */
  rubric?: Rubric;
  judgeModelId?: string;
  signal?: AbortSignal;
  /** Called after each (model, case) pair resolves. */
  onProgress?: (progress: RunProgress) => void;
}

export interface RunProgress {
  completed: number;
  total: number;
  modelId: string;
  caseIndex: number;
  failed: boolean;
}

export interface BenchmarkRunOutput {
  rows: BenchmarkResultRow[];
  summary: BenchmarkSummary;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

/**
 * How many (model, case) pairs are dispatched at once.
 *
 * Fanning out every pair simultaneously trips provider rate limits on any
 * non-trivial dataset, so work is executed through a bounded worker pool.
 */
const DEFAULT_CONCURRENCY = 6;

/**
 * Executes a benchmark: every model against every case, optionally scored.
 *
 * Failures are contained per pair. One model timing out does not fail the run;
 * it produces an errored row and the aggregate reports it under `failures`,
 * because a partial comparison is far more useful than none.
 */
export async function runBenchmark(
  input: BenchmarkRunInput,
): Promise<BenchmarkRunOutput> {
  const env = serverEnv();

  if (input.modelIds.length === 0) {
    throw new AppError('validation_failed', 'Select at least one model to run.');
  }
  if (input.modelIds.length > env.MAX_MODELS_PER_RUN) {
    throw new AppError(
      'validation_failed',
      `A run may target at most ${env.MAX_MODELS_PER_RUN} models; got ${input.modelIds.length}.`,
    );
  }
  if (input.cases.length === 0) {
    throw new AppError('validation_failed', 'A run needs at least one case.');
  }
  if (input.cases.length > env.MAX_DATASET_ROWS) {
    throw new AppError(
      'validation_failed',
      `A run may include at most ${env.MAX_DATASET_ROWS} cases; got ${input.cases.length}.`,
    );
  }

  // Validate every model id up front so a typo fails fast and free rather than
  // partway through a paid run.
  input.modelIds.forEach((id) => requireModel(id));

  const startedAt = new Date();
  const startMs = performance.now();

  const jobs: Array<{ modelId: string; caseIndex: number }> = [];
  for (const modelId of input.modelIds) {
    for (let caseIndex = 0; caseIndex < input.cases.length; caseIndex++) {
      jobs.push({ modelId, caseIndex });
    }
  }

  let completed = 0;
  const rows: BenchmarkResultRow[] = [];

  await pool(jobs, DEFAULT_CONCURRENCY, async (job) => {
    const testCase = input.cases[job.caseIndex]!;
    const row = await executeCase(input, job.modelId, job.caseIndex, testCase);
    rows.push(row);
    completed++;
    input.onProgress?.({
      completed,
      total: jobs.length,
      modelId: job.modelId,
      caseIndex: job.caseIndex,
      failed: row.completion.finishReason === 'error',
    });
  });

  // Restore deterministic ordering; the pool resolves out of order.
  rows.sort(
    (a, b) =>
      input.modelIds.indexOf(a.modelId) - input.modelIds.indexOf(b.modelId) ||
      a.caseIndex - b.caseIndex,
  );

  const finishedAt = new Date();
  return {
    rows,
    summary: summarise(rows),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.round(performance.now() - startMs),
  };
}

async function executeCase(
  input: BenchmarkRunInput,
  modelId: string,
  caseIndex: number,
  testCase: BenchmarkCase,
): Promise<BenchmarkResultRow> {
  const rendered = renderTemplate(input.promptTemplate, testCase.variables);
  const provider = resolveProvider(modelId);
  const model = requireModel(modelId);

  const messages = [
    ...(input.systemPrompt?.trim()
      ? [{ role: 'system' as const, content: input.systemPrompt }]
      : []),
    { role: 'user' as const, content: rendered.text },
  ];

  let completion: CompletionResult;
  try {
    completion = await provider.complete({
      modelId,
      messages,
      params: input.params,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    completion = {
      modelId,
      provider: model.provider,
      resolvedModel: modelId,
      content: '',
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 },
      cost: { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 },
      latencyMs: 0,
      timeToFirstTokenMs: null,
      finishReason: 'error',
      error: error instanceof Error ? error.message : 'Provider call failed.',
    };
  }

  let evaluation = null;
  // Never spend a judge call scoring an empty or errored response.
  if (input.rubric && completion.finishReason !== 'error' && completion.content.trim()) {
    try {
      evaluation = await evaluate({
        prompt: buildJudgePrompt(rendered.text, testCase.expected),
        response: completion.content,
        rubric: input.rubric,
        ...(input.judgeModelId ? { judgeModelId: input.judgeModelId } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch {
      // A judge failure must not discard a perfectly good completion.
      evaluation = null;
    }
  }

  return {
    id: newId('row'),
    modelId,
    caseIndex,
    variables: testCase.variables,
    completion,
    evaluation,
  };
}

function buildJudgePrompt(prompt: string, expected?: string): string {
  if (!expected?.trim()) return prompt;
  return `${prompt}\n\n### Reference answer (ground truth)\n${expected}`;
}

/**
 * Runs tasks with bounded concurrency.
 *
 * Workers pull from a shared cursor rather than being handed fixed slices, so a
 * single slow model cannot leave the other workers idle.
 */
export async function pool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const size = Math.min(Math.max(1, limit), items.length);

  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) break;
      await worker(item);
    }
  });

  await Promise.all(runners);
}

/** Rolls per-row results up into per-model aggregates and a run summary. */
export function summarise(rows: BenchmarkResultRow[]): BenchmarkSummary {
  const modelIds = [...new Set(rows.map((r) => r.modelId))];

  const winRates = computeWinRates(
    rows.map((r) => ({
      modelId: r.modelId,
      caseIndex: r.caseIndex,
      score: r.evaluation?.overallScore ?? null,
    })),
  );

  const models: ModelAggregate[] = modelIds.map((modelId) => {
    const own = rows.filter((r) => r.modelId === modelId);
    const ok = own.filter((r) => r.completion.finishReason !== 'error');
    const latencies = ok.map((r) => r.completion.latencyMs);
    const ttfts = ok
      .map((r) => r.completion.timeToFirstTokenMs)
      .filter((v): v is number => v !== null);
    const scores = own
      .map((r) => r.evaluation?.overallScore)
      .filter((v): v is number => v !== undefined);

    const criterionAverages: Partial<Record<CriterionId, number>> = {};
    const buckets = new Map<CriterionId, number[]>();
    for (const row of own) {
      for (const score of row.evaluation?.criteria ?? []) {
        const list = buckets.get(score.criterionId) ?? [];
        list.push(score.score);
        buckets.set(score.criterionId, list);
      }
    }
    for (const [criterionId, values] of buckets) {
      criterionAverages[criterionId] = round(mean(values));
    }

    const totalCostUsd = own.reduce((sum, r) => sum + r.completion.cost.totalCostUsd, 0);

    return {
      modelId,
      provider: own[0]?.completion.provider ?? 'openrouter',
      runs: own.length,
      failures: own.length - ok.length,
      avgLatencyMs: Math.round(mean(latencies)),
      p95LatencyMs: Math.round(percentile(latencies, 95)),
      avgTimeToFirstTokenMs: ttfts.length > 0 ? Math.round(mean(ttfts)) : null,
      totalCostUsd: round8(totalCostUsd),
      avgCostUsd: round8(own.length > 0 ? totalCostUsd / own.length : 0),
      totalTokens: own.reduce((sum, r) => sum + r.completion.usage.totalTokens, 0),
      avgInputTokens: Math.round(mean(own.map((r) => r.completion.usage.inputTokens))),
      avgOutputTokens: Math.round(mean(own.map((r) => r.completion.usage.outputTokens))),
      avgScore: scores.length > 0 ? round(mean(scores)) : null,
      criterionAverages,
      winRate: winRates.has(modelId) ? round3(winRates.get(modelId)!) : null,
    };
  });

  const scored = models.filter((m) => m.avgScore !== null);
  const winner =
    scored.length > 0
      ? scored.reduce((best, m) => (m.avgScore! > best.avgScore! ? m : best))
      : null;

  // "Best value" is the cheapest model that stays within 5 points of the
  // winner — the practical question is rarely "what is best" but "what is the
  // cheapest thing that is still good enough".
  const bestValue =
    winner && scored.length > 1
      ? scored
          .filter((m) => m.avgScore! >= winner.avgScore! - 5)
          .reduce((cheapest, m) => (m.avgCostUsd < cheapest.avgCostUsd ? m : cheapest))
      : null;

  return {
    totalRuns: rows.length,
    totalCostUsd: round8(models.reduce((sum, m) => sum + m.totalCostUsd, 0)),
    totalTokens: models.reduce((sum, m) => sum + m.totalTokens, 0),
    avgLatencyMs: Math.round(
      mean(
        rows
          .filter((r) => r.completion.finishReason !== 'error')
          .map((r) => r.completion.latencyMs),
      ),
    ),
    models: models.sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1)),
    winnerModelId: winner?.modelId ?? null,
    bestValueModelId: bestValue?.modelId ?? null,
  };
}

const round = (v: number) => Math.round(v * 10) / 10;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round8 = (v: number) => Math.round(v * 1e8) / 1e8;
