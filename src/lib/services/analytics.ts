import { getRepositories } from '@/lib/db';
import type { RunResultRecord } from '@/lib/db/models';
import type { Session } from '@/lib/auth/session';
import type { CriterionId, ProviderId } from '@/lib/core/types';
import { getModel, PROVIDER_LABELS } from '@/lib/models/catalog';
import { mean, percentile } from '@/lib/evaluation/engine';
import { computeWinRates } from '@/lib/evaluation/engine';

/**
 * Workspace-level analytics.
 *
 * Everything here is derived from `run_results`, which is the single source of
 * truth for what actually happened. Nothing is precomputed or cached, because
 * an analytics number that disagrees with the underlying rows is worse than a
 * slow one — and at realistic workspace volumes this is a single indexed read.
 */

export interface OverviewStats {
  totalRuns: number;
  totalCostUsd: number;
  totalTokens: number;
  avgLatencyMs: number;
  modelsEvaluated: number;
  avgScore: number | null;
  /** Percentage change vs the preceding period of equal length. */
  trend: {
    runs: number | null;
    cost: number | null;
    latency: number | null;
    score: number | null;
  };
}

export interface LeaderboardEntry {
  rank: number;
  modelId: string;
  modelName: string;
  provider: ProviderId;
  providerLabel: string;
  runs: number;
  avgScore: number | null;
  winRate: number | null;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgCostUsd: number;
  totalCostUsd: number;
  avgTokens: number;
  criterionAverages: Partial<Record<CriterionId, number>>;
  /** Score per dollar — the practical "is this worth it" number. */
  valueScore: number | null;
}

export interface TimeSeriesPoint {
  date: string;
  runs: number;
  costUsd: number;
  avgLatencyMs: number;
  avgScore: number | null;
  totalTokens: number;
}

export interface AnalyticsSnapshot {
  overview: OverviewStats;
  leaderboard: LeaderboardEntry[];
  timeSeries: TimeSeriesPoint[];
  costByModel: Array<{ modelId: string; modelName: string; costUsd: number }>;
  latencyByModel: Array<{
    modelId: string;
    modelName: string;
    avgMs: number;
    p95Ms: number;
  }>;
  tokensByModel: Array<{
    modelId: string;
    modelName: string;
    input: number;
    output: number;
  }>;
  radar: Array<{ criterion: string; label: string } & Record<string, string | number>>;
  /** Model ids present in the radar series, for chart legend generation. */
  radarModels: string[];
}

const CRITERION_LABELS: Record<CriterionId, string> = {
  correctness: 'Correctness',
  helpfulness: 'Helpfulness',
  reasoning: 'Reasoning',
  code_quality: 'Code quality',
  creativity: 'Creativity',
  hallucination_risk: 'Hallucination',
  instruction_following: 'Instructions',
  safety: 'Safety',
  conciseness: 'Conciseness',
  readability: 'Readability',
};

export async function loadAnalytics(
  session: Session,
  options?: { days?: number; limit?: number },
): Promise<AnalyticsSnapshot> {
  const days = options?.days ?? 30;
  const results = await getRepositories().runResults.listForWorkspace(
    session.workspaceId,
    {
      limit: options?.limit ?? 5_000,
    },
  );

  return buildSnapshot(results, days);
}

/**
 * Pure aggregation over result rows.
 *
 * Kept separate from the repository call so it is directly unit-testable and so
 * the same function serves both the dashboard and exported reports.
 */
export function buildSnapshot(results: RunResultRecord[], days = 30): AnalyticsSnapshot {
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const current = results.filter((r) => now - Date.parse(r.createdAt) <= windowMs);
  const previous = results.filter((r) => {
    const age = now - Date.parse(r.createdAt);
    return age > windowMs && age <= windowMs * 2;
  });

  return {
    overview: buildOverview(current, previous),
    leaderboard: buildLeaderboard(current),
    timeSeries: buildTimeSeries(current, days),
    costByModel: byModel(current, (rows) =>
      round8(rows.reduce((sum, r) => sum + r.costUsd, 0)),
    ).map(([modelId, costUsd]) => ({ modelId, modelName: modelName(modelId), costUsd })),
    latencyByModel: groupBy(current, (r) => r.modelId).map(([modelId, rows]) => ({
      modelId,
      modelName: modelName(modelId),
      avgMs: Math.round(mean(rows.map((r) => r.latencyMs))),
      p95Ms: Math.round(
        percentile(
          rows.map((r) => r.latencyMs),
          95,
        ),
      ),
    })),
    tokensByModel: groupBy(current, (r) => r.modelId).map(([modelId, rows]) => ({
      modelId,
      modelName: modelName(modelId),
      input: rows.reduce((sum, r) => sum + r.completion.usage.inputTokens, 0),
      output: rows.reduce((sum, r) => sum + r.completion.usage.outputTokens, 0),
    })),
    ...buildRadar(current),
  };
}

function buildOverview(
  current: RunResultRecord[],
  previous: RunResultRecord[],
): OverviewStats {
  const scores = current.map((r) => r.score).filter((s): s is number => s !== null);
  const previousScores = previous
    .map((r) => r.score)
    .filter((s): s is number => s !== null);

  const totalCost = current.reduce((sum, r) => sum + r.costUsd, 0);
  const previousCost = previous.reduce((sum, r) => sum + r.costUsd, 0);

  const avgLatency = mean(current.map((r) => r.latencyMs));
  const previousLatency = mean(previous.map((r) => r.latencyMs));

  return {
    totalRuns: current.length,
    totalCostUsd: round8(totalCost),
    totalTokens: current.reduce((sum, r) => sum + r.totalTokens, 0),
    avgLatencyMs: Math.round(avgLatency),
    modelsEvaluated: new Set(current.map((r) => r.modelId)).size,
    avgScore: scores.length > 0 ? round1(mean(scores)) : null,
    trend: {
      runs: percentChange(previous.length, current.length),
      cost: percentChange(previousCost, totalCost),
      latency: percentChange(previousLatency, avgLatency),
      score:
        previousScores.length > 0 && scores.length > 0
          ? percentChange(mean(previousScores), mean(scores))
          : null,
    },
  };
}

/**
 * Percentage change from `before` to `after`.
 *
 * Returns null when there is no baseline — reporting "+100%" against zero
 * prior activity is noise, not information.
 */
export function percentChange(before: number, after: number): number | null {
  if (before === 0) return null;
  return round1(((after - before) / before) * 100);
}

function buildLeaderboard(results: RunResultRecord[]): LeaderboardEntry[] {
  const winRates = computeWinRates(
    results.map((r) => ({ modelId: r.modelId, caseIndex: r.caseIndex, score: r.score })),
  );

  const entries = groupBy(results, (r) => r.modelId).map(([modelId, rows]) => {
    const scores = rows.map((r) => r.score).filter((s): s is number => s !== null);
    const avgScore = scores.length > 0 ? round1(mean(scores)) : null;
    const totalCost = rows.reduce((sum, r) => sum + r.costUsd, 0);
    const avgCost = totalCost / rows.length;

    const criterionAverages: Partial<Record<CriterionId, number>> = {};
    const buckets = new Map<CriterionId, number[]>();
    for (const row of rows) {
      for (const score of row.evaluation?.criteria ?? []) {
        const list = buckets.get(score.criterionId) ?? [];
        list.push(score.score);
        buckets.set(score.criterionId, list);
      }
    }
    for (const [criterionId, values] of buckets) {
      criterionAverages[criterionId] = round1(mean(values));
    }

    const descriptor = getModel(modelId);

    return {
      rank: 0,
      modelId,
      modelName: descriptor?.name ?? modelId,
      provider: descriptor?.provider ?? ('openrouter' as ProviderId),
      providerLabel: PROVIDER_LABELS[descriptor?.provider ?? 'openrouter'],
      runs: rows.length,
      avgScore,
      winRate: winRates.has(modelId) ? round3(winRates.get(modelId)!) : null,
      avgLatencyMs: Math.round(mean(rows.map((r) => r.latencyMs))),
      p95LatencyMs: Math.round(
        percentile(
          rows.map((r) => r.latencyMs),
          95,
        ),
      ),
      avgCostUsd: round8(avgCost),
      totalCostUsd: round8(totalCost),
      avgTokens: Math.round(mean(rows.map((r) => r.totalTokens))),
      criterionAverages,
      // Points of quality per cent spent. Free-tier calls would divide by zero,
      // so those report null rather than Infinity.
      valueScore:
        avgScore !== null && avgCost > 0 ? round1(avgScore / (avgCost * 100)) : null,
    };
  });

  return entries
    .sort(
      (a, b) =>
        (b.avgScore ?? -1) - (a.avgScore ?? -1) || a.avgLatencyMs - b.avgLatencyMs,
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function buildTimeSeries(results: RunResultRecord[], days: number): TimeSeriesPoint[] {
  const buckets = new Map<string, RunResultRecord[]>();

  // Pre-seed every day so the chart shows gaps as zero rather than skipping
  // dates, which would distort the shape of the trend line.
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    buckets.set(date, []);
  }

  for (const result of results) {
    const date = result.createdAt.slice(0, 10);
    if (buckets.has(date)) buckets.get(date)!.push(result);
  }

  return [...buckets.entries()].map(([date, rows]) => {
    const scores = rows.map((r) => r.score).filter((s): s is number => s !== null);
    return {
      date,
      runs: rows.length,
      costUsd: round8(rows.reduce((sum, r) => sum + r.costUsd, 0)),
      avgLatencyMs: rows.length > 0 ? Math.round(mean(rows.map((r) => r.latencyMs))) : 0,
      avgScore: scores.length > 0 ? round1(mean(scores)) : null,
      totalTokens: rows.reduce((sum, r) => sum + r.totalTokens, 0),
    };
  });
}

/**
 * Builds the radar chart series: one axis per criterion, one line per model.
 *
 * Recharts wants one row per axis with a key per series, so the data is pivoted
 * here rather than in the component.
 */
function buildRadar(results: RunResultRecord[]): {
  radar: AnalyticsSnapshot['radar'];
  radarModels: string[];
} {
  const scoresByModel = new Map<string, Map<CriterionId, number[]>>();

  for (const result of results) {
    for (const score of result.evaluation?.criteria ?? []) {
      const model = scoresByModel.get(result.modelId) ?? new Map();
      const list = model.get(score.criterionId) ?? [];
      list.push(score.score);
      model.set(score.criterionId, list);
      scoresByModel.set(result.modelId, model);
    }
  }

  // Cap the series count — a radar chart with a dozen overlapping polygons is
  // unreadable. Top models by evaluated volume win the slots.
  const radarModels = [...scoresByModel.keys()]
    .sort((a, b) => (scoresByModel.get(b)?.size ?? 0) - (scoresByModel.get(a)?.size ?? 0))
    .slice(0, 5);

  const criteria = new Set<CriterionId>();
  for (const modelScores of scoresByModel.values()) {
    for (const criterionId of modelScores.keys()) criteria.add(criterionId);
  }

  const radar = [...criteria].map((criterionId) => {
    const row: { criterion: string; label: string } & Record<string, string | number> = {
      criterion: criterionId,
      label: CRITERION_LABELS[criterionId],
    };
    for (const modelId of radarModels) {
      const values = scoresByModel.get(modelId)?.get(criterionId);
      row[modelId] = values?.length ? round1(mean(values)) : 0;
    }
    return row;
  });

  return { radar, radarModels };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function groupBy<T, K>(items: T[], key: (item: T) => K): Array<[K, T[]]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return [...map.entries()];
}

function byModel<T>(
  results: RunResultRecord[],
  reduce: (rows: RunResultRecord[]) => T,
): Array<[string, T]> {
  return groupBy(results, (r) => r.modelId).map(([modelId, rows]) => [
    modelId,
    reduce(rows),
  ]);
}

function modelName(modelId: string): string {
  return getModel(modelId)?.name ?? modelId;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round8 = (v: number) => Math.round(v * 1e8) / 1e8;
