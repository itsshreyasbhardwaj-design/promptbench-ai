import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { rubricSelectionSchema } from '@/lib/api/schemas';
import { evaluate } from '@/lib/evaluation/engine';
import { resolveRubric } from '@/lib/services/benchmarks';
import { DEFAULT_JUDGE_MODEL } from '@/lib/models/catalog';

export const runtime = 'nodejs';

const evaluateSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  response: z.string().min(1).max(200_000),
  judgeModelId: z.string().max(120).optional(),
  ...rubricSelectionSchema.shape,
});

/**
 * POST /api/v1/evaluate — score an arbitrary response against a rubric.
 *
 * Standalone from benchmarking so the evaluation engine is usable against
 * responses produced elsewhere — an existing pipeline, a production log sample,
 * or a model PromptBench does not have in its catalog.
 */
export const POST = route({
  permission: 'benchmark:run',
  bodySchema: evaluateSchema,
  rateLimit: { limit: 20, windowSeconds: 60 },
  handler: async ({ body }) => {
    const rubric = resolveRubric({
      evaluate: true,
      rubricId: body.rubricId,
      criteria: body.criteria,
    })!;

    return evaluate({
      prompt: body.prompt,
      response: body.response,
      rubric,
      judgeModelId: body.judgeModelId ?? DEFAULT_JUDGE_MODEL,
    });
  },
});
