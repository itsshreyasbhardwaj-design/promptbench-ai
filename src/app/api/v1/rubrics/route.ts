import { route } from '@/lib/api/handler';
import { BUILT_IN_RUBRICS, CRITERIA, isHeuristicOnly } from '@/lib/evaluation/rubrics';

/**
 * GET /api/v1/rubrics — evaluation rubrics and the criterion vocabulary.
 *
 * `costsMoney` is included per rubric because it is the question users actually
 * have before selecting one: heuristic-only rubrics are free and instant, while
 * anything with judge criteria costs a model call per response.
 */
export const GET = route({
  permission: 'benchmark:read',
  handler: async () => ({
    rubrics: BUILT_IN_RUBRICS.map((rubric) => ({
      ...rubric,
      costsMoney: !isHeuristicOnly(rubric),
      judgeCriteriaCount: rubric.criteria.filter((c) => c.scorer === 'llm_judge').length,
    })),
    criteria: Object.values(CRITERIA),
  }),
});
