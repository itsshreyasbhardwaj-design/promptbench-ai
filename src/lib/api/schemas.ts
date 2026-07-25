import { z } from 'zod';
import { ALL_CRITERION_IDS } from '@/lib/evaluation/rubrics';
import type { CriterionId } from '@/lib/core/types';

/**
 * Request schemas for the public REST API.
 *
 * These are the trust boundary. Every bound is deliberate: unbounded strings
 * are a memory-exhaustion vector, and an unbounded `modelIds` array is a way to
 * turn one request into arbitrary provider spend.
 */

const MAX_TEMPLATE_LENGTH = 100_000;
const MAX_NAME_LENGTH = 200;

export const completionParamsSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).max(128_000).default(1024),
  topP: z.number().min(0).max(1).default(1),
  seed: z.number().int().optional(),
  stopSequences: z.array(z.string().max(200)).max(8).optional(),
});

export const createPromptSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  description: z.string().max(2_000).default(''),
  template: z.string().min(1).max(MAX_TEMPLATE_LENGTH),
  systemPrompt: z.string().max(MAX_TEMPLATE_LENGTH).default(''),
  collection: z.string().trim().max(100).nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  params: completionParamsSchema.default({ temperature: 0.7, maxTokens: 1024, topP: 1 }),
});

export const updatePromptSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
  description: z.string().max(2_000).optional(),
  collection: z.string().trim().max(100).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  favorite: z.boolean().optional(),
});

export const createVersionSchema = z.object({
  template: z.string().min(1).max(MAX_TEMPLATE_LENGTH),
  systemPrompt: z.string().max(MAX_TEMPLATE_LENGTH).default(''),
  params: completionParamsSchema,
  changeNote: z.string().max(1_000).default(''),
});

export const listPromptsQuerySchema = z.object({
  search: z.string().max(200).optional(),
  collection: z.string().max(100).optional(),
  tags: z
    .union([z.string(), z.array(z.string())])
    .transform((v) =>
      (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean),
    )
    .optional(),
  favorite: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const rubricSelectionSchema = z.object({
  /** A built-in rubric id, or `custom` when `criteria` is supplied. */
  rubricId: z.string().max(100).optional(),
  criteria: z
    .array(
      z.object({
        id: z.enum(ALL_CRITERION_IDS as [CriterionId, ...CriterionId[]]),
        weight: z.number().min(0.1).max(10).optional(),
      }),
    )
    .min(1)
    .max(ALL_CRITERION_IDS.length)
    .optional(),
});

export const runBenchmarkSchema = z
  .object({
    name: z.string().trim().max(MAX_NAME_LENGTH).default('Ad-hoc run'),
    template: z.string().min(1).max(MAX_TEMPLATE_LENGTH),
    systemPrompt: z.string().max(MAX_TEMPLATE_LENGTH).default(''),
    modelIds: z.array(z.string().min(1).max(120)).min(1).max(32),
    params: completionParamsSchema,
    /** Inline cases. Mutually exclusive with `datasetId`. */
    cases: z
      .array(
        z.object({
          variables: z.record(z.string().max(100), z.string().max(50_000)).default({}),
          expected: z.string().max(50_000).optional(),
        }),
      )
      .max(10_000)
      .optional(),
    datasetId: z.string().max(60).optional(),
    promptId: z.string().max(60).optional(),
    promptVersionId: z.string().max(60).optional(),
    evaluate: z.boolean().default(true),
    judgeModelId: z.string().max(120).optional(),
    ...rubricSelectionSchema.shape,
  })
  .refine((value) => !(value.cases && value.datasetId), {
    message: 'Provide either `cases` or `datasetId`, not both.',
    path: ['cases'],
  });

export const compareSchema = z.object({
  template: z.string().min(1).max(MAX_TEMPLATE_LENGTH),
  systemPrompt: z.string().max(MAX_TEMPLATE_LENGTH).default(''),
  variables: z.record(z.string().max(100), z.string().max(50_000)).default({}),
  modelIds: z.array(z.string().min(1).max(120)).min(1).max(32),
  params: completionParamsSchema,
});

export const createDatasetSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  description: z.string().max(2_000).default(''),
  format: z.enum(['csv', 'json', 'jsonl']),
  /** Raw file contents. Parsed and validated server-side. */
  content: z.string().min(1).max(10_000_000),
});

export const createCommentSchema = z.object({
  targetType: z.enum(['prompt', 'benchmark', 'run']),
  targetId: z.string().min(1).max(60),
  body: z.string().trim().min(1).max(10_000),
});

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const listModelsQuerySchema = z.object({
  provider: z.string().max(40).optional(),
  search: z.string().max(100).optional(),
  judgeCapable: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const reportQuerySchema = z.object({
  format: z.enum(['markdown', 'html', 'json']).default('markdown'),
});

export const listRunsQuerySchema = z.object({
  benchmarkId: z.string().max(60).optional(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreatePromptInput = z.infer<typeof createPromptSchema>;
export type UpdatePromptInput = z.infer<typeof updatePromptSchema>;
export type CreateVersionInput = z.infer<typeof createVersionSchema>;
export type RunBenchmarkInput = z.infer<typeof runBenchmarkSchema>;
export type CompareInput = z.infer<typeof compareSchema>;
export type CreateDatasetInput = z.infer<typeof createDatasetSchema>;
