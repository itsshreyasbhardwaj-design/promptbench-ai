import { describe, expect, it } from 'vitest';
import {
  aggregateScore,
  computeWinRates,
  evaluate,
  mean,
  percentile,
} from '@/lib/evaluation/engine';
import {
  BUILT_IN_RUBRICS,
  createRubric,
  defaultRubric,
  getRubric,
  heuristicCriteria,
  isHeuristicOnly,
  judgeCriteria,
} from '@/lib/evaluation/rubrics';
import {
  analyseText,
  countSyllables,
  fleschReadingEase,
  scoreHeuristic,
} from '@/lib/evaluation/heuristics';
import { parseJudgeResponse } from '@/lib/evaluation/judge';
import type { CriterionScore } from '@/lib/core/types';

describe('rubrics', () => {
  it('ships presets that all declare at least one criterion', () => {
    expect(BUILT_IN_RUBRICS.length).toBeGreaterThan(0);
    for (const rubric of BUILT_IN_RUBRICS) {
      expect(rubric.criteria.length).toBeGreaterThan(0);
    }
  });

  it('marks the heuristic-only preset as free of judge calls', () => {
    const fast = getRubric('fast-heuristic')!;
    expect(isHeuristicOnly(fast)).toBe(true);
    expect(judgeCriteria(fast)).toHaveLength(0);
  });

  it('marks the default rubric as requiring a judge', () => {
    expect(isHeuristicOnly(defaultRubric())).toBe(false);
    expect(judgeCriteria(defaultRubric()).length).toBeGreaterThan(0);
  });

  it('partitions criteria by scorer without dropping any', () => {
    for (const rubric of BUILT_IN_RUBRICS) {
      expect(judgeCriteria(rubric).length + heuristicCriteria(rubric).length).toBe(
        rubric.criteria.length,
      );
    }
  });

  it('builds a custom rubric with overridden weights', () => {
    const rubric = createRubric({
      id: 'custom',
      name: 'Custom',
      criteria: [{ id: 'correctness', weight: 5 }, { id: 'safety' }],
    });

    expect(rubric.criteria).toHaveLength(2);
    expect(rubric.criteria[0]?.weight).toBe(5);
    expect(rubric.builtIn).toBe(false);
  });

  it('refuses an empty rubric', () => {
    expect(() => createRubric({ id: 'x', name: 'X', criteria: [] })).toThrow();
  });
});

describe('aggregateScore', () => {
  const rubric = createRubric({
    id: 'r',
    name: 'R',
    criteria: [
      { id: 'correctness', weight: 3 },
      { id: 'conciseness', weight: 1 },
    ],
  });

  const score = (
    id: 'correctness' | 'conciseness',
    value: number,
    confidence = 1,
  ): CriterionScore => ({
    criterionId: id,
    score: value,
    rationale: '',
    confidence,
  });

  it('returns zero for no scores', () => {
    expect(aggregateScore([], rubric)).toBe(0);
  });

  it('weights criteria by their rubric weight', () => {
    // 3:1 weighting means the result sits much closer to the correctness score.
    const result = aggregateScore(
      [score('correctness', 100), score('conciseness', 0)],
      rubric,
    );
    expect(result).toBeCloseTo(75, 1);
  });

  it('scales weight by scorer confidence so weak signals move it less', () => {
    const confident = aggregateScore(
      [score('correctness', 100, 1), score('conciseness', 0, 1)],
      rubric,
    );
    const unsure = aggregateScore(
      [score('correctness', 100, 1), score('conciseness', 0, 0.1)],
      rubric,
    );

    expect(unsure).toBeGreaterThan(confident);
  });

  it('keeps the scale stable when a criterion is absent', () => {
    expect(aggregateScore([score('correctness', 80)], rubric)).toBeCloseTo(80, 1);
  });
});

describe('computeWinRates', () => {
  it('gives a strictly better model a perfect rate', () => {
    const rates = computeWinRates([
      { modelId: 'a', caseIndex: 0, score: 90 },
      { modelId: 'b', caseIndex: 0, score: 50 },
    ]);

    expect(rates.get('a')).toBe(1);
    expect(rates.get('b')).toBe(0);
  });

  it('splits a tie half to each side', () => {
    const rates = computeWinRates([
      { modelId: 'a', caseIndex: 0, score: 70 },
      { modelId: 'b', caseIndex: 0, score: 70 },
    ]);

    expect(rates.get('a')).toBe(0.5);
    expect(rates.get('b')).toBe(0.5);
  });

  it('only compares cases both models actually scored', () => {
    // b never ran case 1, so it must not be penalised for it.
    const rates = computeWinRates([
      { modelId: 'a', caseIndex: 0, score: 60 },
      { modelId: 'a', caseIndex: 1, score: 99 },
      { modelId: 'b', caseIndex: 0, score: 80 },
    ]);

    expect(rates.get('b')).toBe(1);
    expect(rates.get('a')).toBe(0);
  });

  it('ignores unscored rows entirely', () => {
    const rates = computeWinRates([
      { modelId: 'a', caseIndex: 0, score: null },
      { modelId: 'b', caseIndex: 0, score: 50 },
    ]);

    expect(rates.has('a')).toBe(false);
    expect(rates.get('b')).toBe(0);
  });

  it('reports zero when there is nothing to compare against', () => {
    const rates = computeWinRates([{ modelId: 'solo', caseIndex: 0, score: 90 }]);
    expect(rates.get('solo')).toBe(0);
  });
});

describe('percentile and mean', () => {
  it('returns zero for an empty sample', () => {
    expect(percentile([], 95)).toBe(0);
    expect(mean([])).toBe(0);
  });

  it('returns the only value for a single-element sample', () => {
    expect(percentile([42], 95)).toBe(42);
  });

  it('interpolates between ranks', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 5);
  });

  it('finds the extremes', () => {
    const values = [10, 20, 30, 40, 50];
    expect(percentile(values, 0)).toBe(10);
    expect(percentile(values, 100)).toBe(50);
  });

  it('is insensitive to input order', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(percentile([1, 2, 3, 4, 5], 50));
  });
});

describe('heuristic scorers', () => {
  it('scores an empty response as zero for conciseness', () => {
    expect(scoreHeuristic('conciseness', '')?.score).toBe(0);
  });

  it('refuses to judge readability of a fragment', () => {
    expect(scoreHeuristic('readability', 'too short')?.score).toBe(0);
  });

  it('penalises filler-heavy text on conciseness', () => {
    const dense = scoreHeuristic(
      'conciseness',
      'Optimistic locking suits low-contention workloads; pessimistic locking prevents lost updates under heavy write contention.',
    )!;
    const padded = scoreHeuristic(
      'conciseness',
      'Basically, it is actually really quite very simply just essentially obviously the case that literally basically it is really very simply just quite obviously true.',
    )!;

    expect(dense.score).toBeGreaterThan(padded.score);
  });

  it('returns null for a criterion with no local implementation', () => {
    expect(scoreHeuristic('correctness', 'anything')).toBeNull();
  });

  it('reports confidence below one, since these are proxies', () => {
    const score = scoreHeuristic(
      'readability',
      'A reasonably long sentence with several words in it.',
    )!;
    expect(score.confidence).toBeLessThan(1);
  });

  it('counts syllables plausibly', () => {
    expect(countSyllables('cat')).toBe(1);
    expect(countSyllables('running')).toBe(2);
    expect(countSyllables('')).toBe(0);
    expect(countSyllables('evaluation')).toBeGreaterThanOrEqual(4);
  });

  it('clamps Flesch reading ease into 0-100', () => {
    const dense = analyseText(
      'Notwithstanding aforementioned methodological considerations, the multidimensional characterisation necessitates supplementary corroboration.',
    );
    const score = fleschReadingEase(dense);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('detects list and heading structure', () => {
    expect(analyseText('- one\n- two').hasStructure).toBe(true);
    expect(analyseText('## Heading').hasStructure).toBe(true);
    expect(analyseText('just prose').hasStructure).toBe(false);
  });
});

describe('parseJudgeResponse', () => {
  it('parses bare JSON', () => {
    const verdict = parseJudgeResponse(
      '{"scores":[{"criterion":"safety","score":90,"rationale":"ok"}]}',
    );
    expect(verdict?.scores).toHaveLength(1);
  });

  it('strips markdown fences', () => {
    const verdict = parseJudgeResponse(
      '```json\n{"scores":[{"criterion":"safety","score":90,"rationale":"ok"}]}\n```',
    );
    expect(verdict?.scores[0]?.score).toBe(90);
  });

  it('extracts the object from surrounding prose', () => {
    const verdict = parseJudgeResponse(
      'Here is my assessment:\n{"scores":[{"criterion":"safety","score":75,"rationale":"fine"}]}\nHope that helps.',
    );
    expect(verdict?.scores[0]?.score).toBe(75);
  });

  it('is not confused by braces inside string values', () => {
    const verdict = parseJudgeResponse(
      '{"scores":[{"criterion":"safety","score":80,"rationale":"uses {{var}} correctly"}]}',
    );
    expect(verdict?.scores[0]?.rationale).toContain('{{var}}');
  });

  it('returns null for unparseable output', () => {
    expect(parseJudgeResponse('I refuse to answer.')).toBeNull();
  });

  it('returns null when the JSON lacks a scores array', () => {
    expect(parseJudgeResponse('{"result":"good"}')).toBeNull();
  });
});

describe('evaluate', () => {
  it('scores every criterion in the rubric and stays in range', async () => {
    const rubric = getRubric('fast-heuristic')!;
    const result = await evaluate({
      prompt: 'Explain database locking.',
      response:
        'Optimistic locking assumes conflicts are rare and validates at commit time. ' +
        'Pessimistic locking acquires the lock up front, trading throughput for safety.',
      rubric,
    });

    expect(result.criteria).toHaveLength(rubric.criteria.length);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.rubricId).toBe('fast-heuristic');
    // No judge criteria means no model call was made.
    expect(result.judgeModelId).toBe('heuristic');
  });

  it('orders criteria as the rubric declares them, not as they resolve', async () => {
    const rubric = createRubric({
      id: 'ordered',
      name: 'Ordered',
      criteria: [{ id: 'readability' }, { id: 'conciseness' }],
    });

    const result = await evaluate({
      prompt: 'q',
      response: 'A response with enough words in it to be measurable at all.',
      rubric,
    });

    expect(result.criteria.map((c) => c.criterionId)).toEqual([
      'readability',
      'conciseness',
    ]);
  });

  it('produces a judge-backed score in local mode without a network call', async () => {
    const result = await evaluate({
      prompt: 'q',
      response: 'A reasonably substantive answer with several distinct clauses in it.',
      rubric: getRubric('general-quality')!,
    });

    expect(result.criteria.length).toBeGreaterThan(2);
    // Simulated judging must declare low confidence so it never masquerades
    // as a real verdict.
    const judged = result.criteria.find((c) => c.criterionId === 'correctness');
    expect(judged?.confidence).toBeLessThan(0.5);
    expect(judged?.rationale).toMatch(/simulated/i);
  });

  it('is deterministic for the same input', async () => {
    const args = {
      prompt: 'q',
      response: 'A stable response used to verify determinism across runs.',
      rubric: getRubric('general-quality')!,
    };

    const [a, b] = await Promise.all([evaluate(args), evaluate(args)]);
    expect(a.overallScore).toBe(b.overallScore);
  });
});
