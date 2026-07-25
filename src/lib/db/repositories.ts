import type {
  ApiKeyRecord,
  BenchmarkRecord,
  CommentRecord,
  CommentTarget,
  DatasetRecord,
  ListOptions,
  MemberRecord,
  Page,
  PromptRecord,
  PromptVersionRecord,
  RubricRecord,
  RunRecord,
  RunResultRecord,
  WorkspaceRecord,
} from '@/lib/db/models';

/**
 * Persistence contract.
 *
 * Two drivers implement this: an in-memory store (default, zero-config) and a
 * Postgres store backed by Drizzle. Keeping the surface narrow and explicit —
 * rather than exposing a query builder — is what makes swapping them safe, and
 * what lets the whole API and UI be tested without a database.
 *
 * Every method that reads tenant data takes `workspaceId` as its first
 * argument. That is not decoration: it makes it structurally impossible to
 * write a repository call that forgets to scope by tenant.
 */

export interface PromptFilter extends ListOptions {
  search?: string;
  tags?: string[];
  collection?: string;
  favorite?: boolean;
}

export interface WorkspaceRepository {
  create(
    input: Omit<WorkspaceRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<WorkspaceRecord>;
  findById(id: string): Promise<WorkspaceRecord | null>;
  findBySlug(slug: string): Promise<WorkspaceRecord | null>;
  findByExternalId(externalId: string): Promise<WorkspaceRecord | null>;
  listForUser(userId: string): Promise<WorkspaceRecord[]>;
  update(
    id: string,
    patch: Partial<Pick<WorkspaceRecord, 'name' | 'slug'>>,
  ): Promise<WorkspaceRecord>;
  delete(id: string): Promise<void>;
}

export interface MemberRepository {
  add(input: Omit<MemberRecord, 'createdAt' | 'updatedAt'>): Promise<MemberRecord>;
  find(workspaceId: string, userId: string): Promise<MemberRecord | null>;
  list(workspaceId: string): Promise<MemberRecord[]>;
  updateRole(
    workspaceId: string,
    userId: string,
    role: MemberRecord['role'],
  ): Promise<MemberRecord>;
  remove(workspaceId: string, userId: string): Promise<void>;
}

export interface PromptRepository {
  create(input: Omit<PromptRecord, 'createdAt' | 'updatedAt'>): Promise<PromptRecord>;
  findById(workspaceId: string, id: string): Promise<PromptRecord | null>;
  list(workspaceId: string, filter?: PromptFilter): Promise<Page<PromptRecord>>;
  update(
    workspaceId: string,
    id: string,
    patch: Partial<
      Pick<
        PromptRecord,
        'name' | 'description' | 'collection' | 'tags' | 'favorite' | 'currentVersionId'
      >
    >,
  ): Promise<PromptRecord>;
  delete(workspaceId: string, id: string): Promise<void>;
  /** Distinct collection names in the workspace, for the library sidebar. */
  listCollections(workspaceId: string): Promise<string[]>;
  /** Distinct tags with usage counts, for filter chips. */
  listTags(workspaceId: string): Promise<Array<{ tag: string; count: number }>>;
}

export interface PromptVersionRepository {
  create(input: Omit<PromptVersionRecord, 'createdAt'>): Promise<PromptVersionRecord>;
  findById(workspaceId: string, id: string): Promise<PromptVersionRecord | null>;
  /** Newest first. */
  listForPrompt(workspaceId: string, promptId: string): Promise<PromptVersionRecord[]>;
  /** Highest existing version number for a prompt, or 0 when it has none. */
  latestVersionNumber(promptId: string): Promise<number>;
}

export interface DatasetRepository {
  create(input: Omit<DatasetRecord, 'createdAt' | 'updatedAt'>): Promise<DatasetRecord>;
  findById(workspaceId: string, id: string): Promise<DatasetRecord | null>;
  list(workspaceId: string, options?: ListOptions): Promise<Page<DatasetRecord>>;
  delete(workspaceId: string, id: string): Promise<void>;
}

export interface RubricRepository {
  create(input: Omit<RubricRecord, 'createdAt' | 'updatedAt'>): Promise<RubricRecord>;
  findById(workspaceId: string, id: string): Promise<RubricRecord | null>;
  list(workspaceId: string): Promise<RubricRecord[]>;
  delete(workspaceId: string, id: string): Promise<void>;
}

export interface BenchmarkRepository {
  create(
    input: Omit<BenchmarkRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<BenchmarkRecord>;
  findById(workspaceId: string, id: string): Promise<BenchmarkRecord | null>;
  list(workspaceId: string, options?: ListOptions): Promise<Page<BenchmarkRecord>>;
  delete(workspaceId: string, id: string): Promise<void>;
}

export interface RunRepository {
  create(input: Omit<RunRecord, 'createdAt' | 'updatedAt'>): Promise<RunRecord>;
  findById(workspaceId: string, id: string): Promise<RunRecord | null>;
  list(
    workspaceId: string,
    options?: ListOptions & { benchmarkId?: string; status?: RunRecord['status'] },
  ): Promise<Page<RunRecord>>;
  update(
    id: string,
    patch: Partial<Omit<RunRecord, 'id' | 'createdAt'>>,
  ): Promise<RunRecord>;
  delete(workspaceId: string, id: string): Promise<void>;
}

export interface RunResultRepository {
  createMany(rows: Array<Omit<RunResultRecord, 'createdAt'>>): Promise<RunResultRecord[]>;
  listForRun(workspaceId: string, runId: string): Promise<RunResultRecord[]>;
  /** All results in a workspace, newest first — the analytics source of truth. */
  listForWorkspace(
    workspaceId: string,
    options?: ListOptions,
  ): Promise<RunResultRecord[]>;
}

export interface CommentRepository {
  create(input: Omit<CommentRecord, 'createdAt' | 'updatedAt'>): Promise<CommentRecord>;
  listForTarget(
    workspaceId: string,
    targetType: CommentTarget,
    targetId: string,
  ): Promise<CommentRecord[]>;
  delete(workspaceId: string, id: string): Promise<void>;
}

export interface ApiKeyRepository {
  create(input: Omit<ApiKeyRecord, 'createdAt' | 'updatedAt'>): Promise<ApiKeyRecord>;
  findByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  list(workspaceId: string): Promise<ApiKeyRecord[]>;
  touch(id: string): Promise<void>;
  revoke(workspaceId: string, id: string): Promise<void>;
}

export interface Repositories {
  workspaces: WorkspaceRepository;
  members: MemberRepository;
  prompts: PromptRepository;
  promptVersions: PromptVersionRepository;
  datasets: DatasetRepository;
  rubrics: RubricRepository;
  benchmarks: BenchmarkRepository;
  runs: RunRepository;
  runResults: RunResultRepository;
  comments: CommentRepository;
  apiKeys: ApiKeyRepository;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function normaliseListOptions(options?: ListOptions): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(Math.max(options?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(options?.offset ?? 0, 0);
  return { limit, offset };
}

export function paginate<T>(items: T[], options?: ListOptions): Page<T> {
  const { limit, offset } = normaliseListOptions(options);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}
