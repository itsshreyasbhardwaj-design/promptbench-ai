import type {
  BenchmarkSummary,
  CompletionParams,
  CompletionResult,
  Criterion,
  EvaluationResult,
  RunStatus,
} from '@/lib/core/types';

/**
 * Storage-agnostic record shapes.
 *
 * Repositories return these regardless of driver, so nothing above the
 * persistence layer knows or cares whether a row came from Postgres or memory.
 * Dates are ISO strings rather than `Date` so records cross the server/client
 * boundary without a serialisation step.
 */

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type DatasetFormat = 'csv' | 'json' | 'jsonl';
export type CommentTarget = 'prompt' | 'benchmark' | 'run';

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberRecord {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface PromptRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  collection: string | null;
  tags: string[];
  favorite: boolean;
  currentVersionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptVersionRecord {
  id: string;
  promptId: string;
  workspaceId: string;
  version: number;
  template: string;
  systemPrompt: string;
  params: CompletionParams;
  changeNote: string;
  createdBy: string;
  createdAt: string;
}

export interface DatasetRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  format: DatasetFormat;
  columns: string[];
  rowCount: number;
  rows: Array<Record<string, string>>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RubricRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  criteria: Criterion[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  promptId: string | null;
  promptVersionId: string | null;
  datasetId: string | null;
  modelIds: string[];
  rubricId: string | null;
  judgeModelId: string | null;
  params: CompletionParams;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  benchmarkId: string;
  workspaceId: string;
  status: RunStatus;
  promptTemplate: string;
  systemPrompt: string;
  modelIds: string[];
  summary: BenchmarkSummary | null;
  totalCostUsd: number;
  totalTokens: number;
  avgLatencyMs: number;
  caseCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunResultRecord {
  id: string;
  runId: string;
  workspaceId: string;
  modelId: string;
  caseIndex: number;
  variables: Record<string, string>;
  completion: CompletionResult;
  evaluation: EvaluationResult | null;
  score: number | null;
  latencyMs: number;
  costUsd: number;
  totalTokens: number;
  createdAt: string;
}

export interface CommentRecord {
  id: string;
  workspaceId: string;
  targetType: CommentTarget;
  targetId: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyRecord {
  id: string;
  workspaceId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
}
