import type { CriterionScore, EvaluationResult, Rubric } from '@/lib/core/types';
import { heuristicCriteria, judgeCriteria } from '@/lib/evaluation/rubrics';
import { scoreHeuristic } from '@/lib/evaluation/heuristics';
import { runJudge } from '@/lib/evaluation/judge';
import { DEFAULT_JUDGE_MODEL } from '@/lib/models/catalog';

export interface EvaluateOptions {
  prompt: string;
  response: string;
  rubric: Rubric;
  judgeModelId?: string;
  signal?: AbortSignal;
}

/**
 * Evaluates one response against one rubric.
 *
 * Heuristic criteria are computed locally and judge criteria are batched into a
 * single model call, so a six-criterion rubric costs at most one request. The
 * two run concurrently.
 */
export async function evaluate(options: EvaluateOptions): Promise<EvaluationResult> {
  const { prompt, response, rubric } = options;
  const judgeModelId = options.judgeModelId ?? DEFAULT_JUDGE_MODEL;

  const local = heuristicCriteria(rubric)
    .map((criterion) => scoreHeuristic(criterion.id, response))
    .filter((score): score is CriterionScore => score !== null);

  const judged = await runJudge({
    prompt,
    response,
    criteria: judgeCriteria(rubric),
    judgeModelId,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const criteria = [...judged, ...local];

  return {
    overallScore: aggregateScore(criteria, rubric),
    criteria: orderByRubric(criteria, rubric),
    rubricId: rubric.id,
    judgeModelId: judgeCriteria(rubric).length > 0 ? judgeModelId : 'heuristic',
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Weighted aggregate of criterion scores, 0–100.
 *
 * Weights come from the rubric and are normalised here, so removing a criterion
 * never changes the scale of the result. Each criterion's weight is additionally
 * scaled by the scorer's own confidence: a heuristic proxy (confidence ~0.6)
 * should not move the headline number as much as a judge verdict (~0.85). This
 * keeps mixed rubrics honest rather than letting cheap signals dominate.
 */
export function aggregateScore(scores: CriterionScore[], rubric: Rubric): number {
  if (scores.length === 0) return 0;

  const weightById = new Map(rubric.criteria.map((c) => [c.id, c.weight]));

  let weightedSum = 0;
  let totalWeight = 0;

  for (const score of scores) {
    const weight = (weightById.get(score.criterionId) ?? 1) * score.confidence;
    weightedSum += score.score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}

/** Presents criteria in rubric-declared order rather than completion order. */
function orderByRubric(scores: CriterionScore[], rubric: Rubric): CriterionScore[] {
  const order = new Map(rubric.criteria.map((c, i) => [c.id, i]));
  return [...scores].sort(
    (a, b) => (order.get(a.criterionId) ?? 99) - (order.get(b.criterionId) ?? 99),
  );
}

/**
 * Head-to-head win rates.
 *
 * Every model is compared against every other model on each shared case. A win
 * is a strictly higher score on the same case; ties count as half a win to both
 * sides, which is the standard convention and avoids penalising models that
 * genuinely tie. Returns a 0–1 rate per model.
 *
 * Only cases where both models produced a score are compared, so a model that
 * failed on some cases is not credited or penalised for them here — failures
 * surface separately in `ModelAggregate.failures`.
 */
export function computeWinRates(
  results: Array<{ modelId: string; caseIndex: number; score: number | null }>,
): Map<string, number> {
  const byModel = new Map<string, Map<number, number>>();

  for (const row of results) {
    if (row.score === null) continue;
    let cases = byModel.get(row.modelId);
    if (!cases) {
      cases = new Map();
      byModel.set(row.modelId, cases);
    }
    cases.set(row.caseIndex, row.score);
  }

  const models = [...byModel.keys()];
  const winRates = new Map<string, number>();

  for (const model of models) {
    const own = byModel.get(model)!;
    let wins = 0;
    let comparisons = 0;

    for (const opponent of models) {
      if (opponent === model) continue;
      const other = byModel.get(opponent)!;

      for (const [caseIndex, score] of own) {
        const rival = other.get(caseIndex);
        if (rival === undefined) continue;
        comparisons++;
        if (score > rival) wins += 1;
        else if (score === rival) wins += 0.5;
      }
    }

    winRates.set(model, comparisons === 0 ? 0 : wins / comparisons);
  }

  return winRates;
}

/**
 * Percentile from a sample, using linear interpolation between ranks.
 * Returns 0 for an empty sample.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;

  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower]!;

  const weight = rank - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
