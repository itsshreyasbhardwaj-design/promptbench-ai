import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  BenchmarkSummary,
  CompletionParams,
  CompletionResult,
  Criterion,
  EvaluationResult,
} from '@/lib/core/types';

/**
 * Postgres schema (Supabase-compatible).
 *
 * Design notes:
 * - Ids are application-generated prefixed strings rather than serial or uuid,
 *   so an object's type is legible from its id anywhere it appears.
 * - Large, shape-stable payloads (completions, evaluations, aggregates) live in
 *   `jsonb`. They are written once and read whole; normalising them would cost
 *   a dozen joins on every result-grid render for no query benefit. Anything
 *   actually filtered or sorted on is promoted to a real column.
 * - Every tenant-scoped table carries `workspaceId` directly, so row-level
 *   security policies and access checks are a single predicate.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const workspaces = pgTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Clerk organization id when managed auth is enabled. */
    externalId: text('external_id'),
    ...timestamps,
  },
  (table) => [uniqueIndex('workspaces_slug_idx').on(table.slug)],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    /** owner | admin | editor | viewer — enforced in `lib/auth/permissions.ts`. */
    role: text('role').notNull().default('editor'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('workspace_members_unique_idx').on(table.workspaceId, table.userId),
    index('workspace_members_user_idx').on(table.userId),
  ],
);

export const prompts = pgTable(
  'prompts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Free-form collection name used to group prompts in the library. */
    collection: text('collection'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    favorite: boolean('favorite').notNull().default(false),
    /** Points at the version currently treated as canonical. */
    currentVersionId: text('current_version_id'),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [
    index('prompts_workspace_idx').on(table.workspaceId),
    index('prompts_collection_idx').on(table.workspaceId, table.collection),
  ],
);

export const promptVersions = pgTable(
  'prompt_versions',
  {
    id: text('id').primaryKey(),
    promptId: text('prompt_id')
      .notNull()
      .references(() => prompts.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull(),
    /** Monotonic, 1-based, per prompt. */
    version: integer('version').notNull(),
    template: text('template').notNull(),
    systemPrompt: text('system_prompt').notNull().default(''),
    params: jsonb('params').$type<CompletionParams>().notNull(),
    /** Author's note describing what changed and why. */
    changeNote: text('change_note').notNull().default(''),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('prompt_versions_unique_idx').on(table.promptId, table.version),
    index('prompt_versions_prompt_idx').on(table.promptId),
  ],
);

export const datasets = pgTable(
  'datasets',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** csv | json | jsonl */
    format: text('format').notNull(),
    /** Column names discovered at parse time, in file order. */
    columns: jsonb('columns').$type<string[]>().notNull().default([]),
    rowCount: integer('row_count').notNull().default(0),
    rows: jsonb('rows').$type<Array<Record<string, string>>>().notNull().default([]),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [index('datasets_workspace_idx').on(table.workspaceId)],
);

export const rubrics = pgTable(
  'rubrics',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    criteria: jsonb('criteria').$type<Criterion[]>().notNull(),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [index('rubrics_workspace_idx').on(table.workspaceId)],
);

export const benchmarks = pgTable(
  'benchmarks',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    promptId: text('prompt_id'),
    promptVersionId: text('prompt_version_id'),
    datasetId: text('dataset_id'),
    modelIds: jsonb('model_ids').$type<string[]>().notNull(),
    rubricId: text('rubric_id'),
    judgeModelId: text('judge_model_id'),
    params: jsonb('params').$type<CompletionParams>().notNull(),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [index('benchmarks_workspace_idx').on(table.workspaceId)],
);

export const benchmarkRuns = pgTable(
  'benchmark_runs',
  {
    id: text('id').primaryKey(),
    benchmarkId: text('benchmark_id')
      .notNull()
      .references(() => benchmarks.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull(),
    /** queued | running | succeeded | failed | cancelled */
    status: text('status').notNull().default('queued'),
    /** Snapshot of the template actually executed, for reproducibility. */
    promptTemplate: text('prompt_template').notNull(),
    systemPrompt: text('system_prompt').notNull().default(''),
    modelIds: jsonb('model_ids').$type<string[]>().notNull(),
    summary: jsonb('summary').$type<BenchmarkSummary | null>(),
    totalCostUsd: real('total_cost_usd').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    avgLatencyMs: integer('avg_latency_ms').notNull().default(0),
    caseCount: integer('case_count').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [
    index('benchmark_runs_benchmark_idx').on(table.benchmarkId),
    index('benchmark_runs_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('benchmark_runs_status_idx').on(table.status),
  ],
);

export const runResults = pgTable(
  'run_results',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => benchmarkRuns.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull(),
    modelId: text('model_id').notNull(),
    caseIndex: integer('case_index').notNull(),
    variables: jsonb('variables').$type<Record<string, string>>().notNull().default({}),
    completion: jsonb('completion').$type<CompletionResult>().notNull(),
    evaluation: jsonb('evaluation').$type<EvaluationResult | null>(),
    // Promoted from the jsonb payloads because every analytics query sorts or
    // filters on them; keeping them inline would force a full scan + parse.
    score: real('score'),
    latencyMs: integer('latency_ms').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('run_results_run_idx').on(table.runId),
    index('run_results_model_idx').on(table.workspaceId, table.modelId),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** prompt | benchmark | run */
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    body: text('body').notNull(),
    authorId: text('author_id').notNull(),
    authorName: text('author_name').notNull(),
    ...timestamps,
  },
  (table) => [index('comments_target_idx').on(table.targetType, table.targetId)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** SHA-256 of the key. The plaintext is shown once at creation and never stored. */
    keyHash: text('key_hash').notNull(),
    /** First 8 characters, for display so users can identify a key. */
    keyPrefix: text('key_prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('api_keys_hash_idx').on(table.keyHash),
    index('api_keys_workspace_idx').on(table.workspaceId),
  ],
);

export const schema = {
  workspaces,
  workspaceMembers,
  prompts,
  promptVersions,
  datasets,
  rubrics,
  benchmarks,
  benchmarkRuns,
  runResults,
  comments,
  apiKeys,
};
