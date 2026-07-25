import { AppError, notFound } from '@/lib/core/errors';
import { newId } from '@/lib/core/id';
import { getRepositories } from '@/lib/db';
import type { RunRecord, RunResultRecord } from '@/lib/db/models';
import type { Session } from '@/lib/auth/session';
import type { RunBenchmarkInput } from '@/lib/api/schemas';
import type { BenchmarkSummary, CompletionParams, Rubric } from '@/lib/core/types';
import { runBenchmark, type BenchmarkCase } from '@/lib/benchmark/runner';
import { createRubric, getRubric } from '@/lib/evaluation/rubrics';
import { extractVariables } from '@/lib/prompts/template';
import { DEFAULT_JUDGE_MODEL } from '@/lib/models/catalog';

/**
 * Benchmark execution.
 *
 * A run is persisted before execution starts, in `running` state, so a client
 * that disconnects mid-run can still find the record and its eventual outcome.
 * Failures are recorded on the run rather than propagated as an unhandled
 * error, because a run that failed is itself a result worth keeping.
 */

export interface RunWithResults {
  run: RunRecord;
  results: RunResultRecord[];
}

/** Resolves the rubric a run should use: built-in, custom, or none. */
export function resolveRubric(input: {
  evaluate: boolean;
  rubricId?: string | undefined;
  criteria?:
    | Array<{
        id: Parameters<typeof createRubric>[0]['criteria'][number]['id'];
        weight?: number;
      }>
    | undefined;
}): Rubric | undefined {
  if (!input.evaluate) return undefined;

  if (input.criteria?.length) {
    return createRubric({
      id: 'custom',
      name: 'Custom rubric',
      description: 'Criteria selected for this run.',
      criteria: input.criteria,
    });
  }

  if (input.rubricId) {
    const rubric = getRubric(input.rubricId);
    if (!rubric) {
      throw new AppError('validation_failed', `Unknown rubric "${input.rubricId}".`);
    }
    return rubric;
  }

  return getRubric('general-quality');
}

/**
 * Builds the case list for a run.
 *
 * When a dataset is supplied, each row becomes a case and only the columns the
 * template actually references are passed through — a dataset with fifty
 * columns should not inflate every prompt with forty-nine unused variables.
 * A column named `expected` is treated as ground truth by convention.
 */
export async function buildCases(
  session: Session,
  input: RunBenchmarkInput,
): Promise<BenchmarkCase[]> {
  if (input.cases?.length) {
    return input.cases.map((c) => ({
      variables: c.variables,
      ...(c.expected ? { expected: c.expected } : {}),
    }));
  }

  if (input.datasetId) {
    const dataset = await getRepositories().datasets.findById(
      session.workspaceId,
      input.datasetId,
    );
    if (!dataset) throw notFound('Dataset', input.datasetId);

    const variableNames = new Set(extractVariables(input.template).map((v) => v.name));

    return dataset.rows.map((row) => {
      const variables: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        if (variableNames.has(key)) variables[key] = value;
      }
      const expected = row.expected ?? row.answer ?? row.ground_truth;
      return { variables, ...(expected ? { expected } : {}) };
    });
  }

  // No cases and no dataset means a single render of the template as-is.
  return [{ variables: {} }];
}

export async function executeRun(
  session: Session,
  input: RunBenchmarkInput,
): Promise<RunWithResults> {
  const repos = getRepositories();
  const rubric = resolveRubric(input);
  const cases = await buildCases(session, input);

  const benchmark = await repos.benchmarks.create({
    id: newId('bench'),
    workspaceId: session.workspaceId,
    name: input.name,
    description: '',
    promptId: input.promptId ?? null,
    promptVersionId: input.promptVersionId ?? null,
    datasetId: input.datasetId ?? null,
    modelIds: input.modelIds,
    rubricId: rubric?.id ?? null,
    judgeModelId: input.judgeModelId ?? (rubric ? DEFAULT_JUDGE_MODEL : null),
    params: input.params as CompletionParams,
    createdBy: session.userId,
  });

  const runId = newId('run');
  let run = await repos.runs.create({
    id: runId,
    benchmarkId: benchmark.id,
    workspaceId: session.workspaceId,
    status: 'running',
    promptTemplate: input.template,
    systemPrompt: input.systemPrompt,
    modelIds: input.modelIds,
    summary: null,
    totalCostUsd: 0,
    totalTokens: 0,
    avgLatencyMs: 0,
    caseCount: cases.length,
    errorMessage: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    createdBy: session.userId,
  });

  try {
    const output = await runBenchmark({
      promptTemplate: input.template,
      systemPrompt: input.systemPrompt,
      modelIds: input.modelIds,
      params: input.params as CompletionParams,
      cases,
      ...(rubric ? { rubric } : {}),
      ...(input.judgeModelId ? { judgeModelId: input.judgeModelId } : {}),
    });

    const results = await repos.runResults.createMany(
      output.rows.map((row) => ({
        id: row.id,
        runId,
        workspaceId: session.workspaceId,
        modelId: row.modelId,
        caseIndex: row.caseIndex,
        variables: row.variables,
        completion: row.completion,
        evaluation: row.evaluation,
        score: row.evaluation?.overallScore ?? null,
        latencyMs: row.completion.latencyMs,
        costUsd: row.completion.cost.totalCostUsd,
        totalTokens: row.completion.usage.totalTokens,
      })),
    );

    run = await repos.runs.update(runId, {
      status: 'succeeded',
      summary: output.summary,
      totalCostUsd: output.summary.totalCostUsd,
      totalTokens: output.summary.totalTokens,
      avgLatencyMs: output.summary.avgLatencyMs,
      finishedAt: output.finishedAt,
    });

    return { run, results };
  } catch (error) {
    run = await repos.runs.update(runId, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Run failed.',
      finishedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export async function getRun(session: Session, runId: string): Promise<RunWithResults> {
  const repos = getRepositories();
  const run = await repos.runs.findById(session.workspaceId, runId);
  if (!run) throw notFound('Run', runId);
  const results = await repos.runResults.listForRun(session.workspaceId, runId);
  return { run, results };
}

export async function listRuns(
  session: Session,
  options?: {
    benchmarkId?: string;
    status?: RunRecord['status'];
    limit?: number;
    offset?: number;
  },
) {
  return getRepositories().runs.list(session.workspaceId, options);
}

export async function deleteRun(session: Session, runId: string): Promise<void> {
  const repos = getRepositories();
  const run = await repos.runs.findById(session.workspaceId, runId);
  if (!run) throw notFound('Run', runId);
  await repos.runs.delete(session.workspaceId, runId);
}

/** Empty summary used when a run has no rows yet. */
export function emptySummary(): BenchmarkSummary {
  return {
    totalRuns: 0,
    totalCostUsd: 0,
    totalTokens: 0,
    avgLatencyMs: 0,
    models: [],
    winnerModelId: null,
    bestValueModelId: null,
  };
}
