import { and, count, desc, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { conflict, notFound } from '@/lib/core/errors';
import type {
  ApiKeyRecord,
  BenchmarkRecord,
  CommentRecord,
  CommentTarget,
  DatasetFormat,
  DatasetRecord,
  ListOptions,
  MemberRecord,
  Page,
  PromptRecord,
  PromptVersionRecord,
  Role,
  RubricRecord,
  RunRecord,
  RunResultRecord,
  WorkspaceRecord,
} from '@/lib/db/models';
import type {
  ApiKeyRepository,
  BenchmarkRepository,
  CommentRepository,
  DatasetRepository,
  MemberRepository,
  PromptFilter,
  PromptRepository,
  PromptVersionRepository,
  Repositories,
  RubricRepository,
  RunRepository,
  RunResultRepository,
  WorkspaceRepository,
} from '@/lib/db/repositories';
import { normaliseListOptions } from '@/lib/db/repositories';
import * as t from '@/lib/db/schema';
import type { RunStatus } from '@/lib/core/types';

/**
 * Postgres persistence driver.
 *
 * Mirrors `MemoryRepositories` exactly. The two are kept behaviourally
 * identical by running the same conformance suite against both
 * (`repositories.test.ts`), which is what makes the in-memory driver a
 * trustworthy stand-in rather than a divergent second implementation.
 *
 * Timestamps come back from the driver as `Date` and are serialised to ISO
 * strings at this boundary so records are structurally identical across drivers
 * and safe to pass to client components.
 */

export type Database = PostgresJsDatabase<typeof t>;

let client: ReturnType<typeof postgres> | null = null;
let database: Database | null = null;

export function getDatabase(connectionString: string): Database {
  if (database) return database;
  client = postgres(connectionString, {
    // Serverless runtimes create many short-lived instances; a small pool per
    // instance avoids exhausting Postgres connection slots.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  database = drizzle(client, { schema: t });
  return database;
}

export async function closeDatabase(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = null;
  database = null;
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;
const isoRequired = (value: Date): string => value.toISOString();

function page<T>(items: T[], total: number, options?: ListOptions): Page<T> {
  const { limit, offset } = normaliseListOptions(options);
  return { items, total, limit, offset };
}

// ── Row mappers ─────────────────────────────────────────────────────────────

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];

const toWorkspace = (r: Row<typeof t.workspaces>): WorkspaceRecord => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  externalId: r.externalId,
  createdAt: isoRequired(r.createdAt),
  updatedAt: isoRequired(r.updatedAt),
});

const toMember = (r: Row<typeof t.workspaceMembers>): MemberRecord => ({
  id: r.id,
  workspaceId: r.workspaceId,
  userId: r.userId,
  email: r.email,
  displayName: r.displayName,
  role: r.role as Role,
  createdAt: isoRequired(r.createdAt),
  updatedAt: isoRequired(r.updatedAt),
});

const toPrompt = (r: Row<typeof t.prompts>): PromptRecord => ({
  id: r.id,
  workspaceId: r.workspaceId,
  name: r.name,
  description: r.description,
  collection: r.collection,
  tags: r.tags,
  favorite: r.favorite,
  currentVersionId: r.currentVersionId,
  createdBy: r.createdBy,
  createdAt: isoRequired(r.createdAt),
  updatedAt: isoRequired(r.updatedAt),
});

const toVersion = (r: Row<typeof t.promptVersions>): PromptVersionRecord => ({
  id: r.id,
  promptId: r.promptId,
  workspaceId: r.workspaceId,
  version: r.version,
  template: r.template,
  systemPrompt: r.systemPrompt,
  params: r.params,
  changeNote: r.changeNote,
  createdBy: r.createdBy,
  createdAt: isoRequired(r.createdAt),
});

const toDataset = (r: Row<typeof t.datasets>): DatasetRecord => ({
  id: r.id,
  workspaceId: r.workspaceId,
  name: r.name,
  description: r.description,
  format: r.format as DatasetFormat,
  columns: r.columns,
  rowCount: r.rowCount,
  rows: r.rows,
  createdBy: r.createdBy,
  createdAt: isoRequired(r.createdAt),
  updatedAt: isoRequired(r.updatedAt),
});

const toRubric = (r: Row<typeof t.rubrics>): RubricRecord => ({
  id: r.id,
  workspaceId: r.workspaceId,
  name: r.name,
  description: r.description,
  criteria: r.criteria,
  createdBy: r.createdBy,
  createdAt: isoRequired(r.createdAt),
  updatedAt: isoRequired(r.updatedAt),
});

const toBenchmark = (r: Row<typeof t.benchmarks>): BenchmarkRecord => ({
  id: r.id,
  workspaceId: r.workspaceId,
  name: r.name,
  description: r.description,
  promptId: r.promptId,
  promptVersionId: r.promptVersionId,
  datasetId: r.datasetId,
  modelIds: r.modelIds,
  rubricId: r.rubricId,
  judgeModelId: r.judgeModelId,
  params: r.params,
  createdBy: r.createdBy,
  createdAt: isoRequired(r.createdAt),
  updatedAt: isoRequired(r.updatedAt),
});

const toRun = (r: Row<typeof t.benchmarkRuns>): RunRecord => ({
  id: r.id,
  benchmarkId: r.benchmarkId,
  workspaceId: r.workspaceId,
  status: r.status as RunStatus,
  promptTemplate: r.promptTemplate,
  systemPrompt: r.systemPrompt,
  modelIds: r.modelIds,
  summary: r.summary ?? null,
  totalCostUsd: r.totalCostUsd,
  totalTokens: r.totalTokens,
  avgLatencyMs: r.avgLatencyMs,
  caseCount: r.caseCount,
  errorMessage: r.errorMessage,
  startedAt: iso(r.startedAt),
  finishedAt: iso(r.finishedAt),
  createdBy: r.createdBy,
  createdAt: isoRequired(r.createdAt),
  updatedAt: isoRequired(r.updatedAt),
});

const toResult = (r: Row<typeof t.runResults>): RunResultRecord => ({
  id: r.id,
  runId: r.runId,
  workspaceId: r.workspaceId,
  modelId: r.modelId,
  caseIndex: r.caseIndex,
  variables: r.variables,
  completion: r.completion,
  evaluation: r.evaluation ?? null,
  score: r.score,
  latencyMs: r.latencyMs,
  costUsd: r.costUsd,
  totalTokens: r.totalTokens,
  createdAt: isoRequired(r.createdAt),
});

const toComment = (r: Row<typeof t.comments>): CommentRecord => ({
  id: r.id,
  workspaceId: r.workspaceId,
  targetType: r.targetType as CommentTarget,
  targetId: r.targetId,
  body: r.body,
  authorId: r.authorId,
  authorName: r.authorName,
  createdAt: isoRequired(r.createdAt),
  updatedAt: isoRequired(r.updatedAt),
});

const toApiKey = (r: Row<typeof t.apiKeys>): ApiKeyRecord => ({
  id: r.id,
  workspaceId: r.workspaceId,
  name: r.name,
  keyHash: r.keyHash,
  keyPrefix: r.keyPrefix,
  lastUsedAt: iso(r.lastUsedAt),
  revokedAt: iso(r.revokedAt),
  createdBy: r.createdBy,
  createdAt: isoRequired(r.createdAt),
  updatedAt: isoRequired(r.updatedAt),
});

async function countRows(
  db: Database,
  table: PgTable,
  where: SQL | undefined,
): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table).where(where);
  return row?.value ?? 0;
}

// ── Repositories ────────────────────────────────────────────────────────────

class PgWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: Database) {}

  async create(input: Omit<WorkspaceRecord, 'createdAt' | 'updatedAt'>) {
    const existing = await this.findBySlug(input.slug);
    if (existing) throw conflict(`Workspace slug "${input.slug}" is already taken.`);
    const [row] = await this.db.insert(t.workspaces).values(input).returning();
    return toWorkspace(row!);
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.id, id));
    return row ? toWorkspace(row) : null;
  }

  async findBySlug(slug: string) {
    const [row] = await this.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.slug, slug));
    return row ? toWorkspace(row) : null;
  }

  async findByExternalId(externalId: string) {
    const [row] = await this.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.externalId, externalId));
    return row ? toWorkspace(row) : null;
  }

  async listForUser(userId: string) {
    const rows = await this.db
      .select({ workspace: t.workspaces })
      .from(t.workspaces)
      .innerJoin(t.workspaceMembers, eq(t.workspaceMembers.workspaceId, t.workspaces.id))
      .where(eq(t.workspaceMembers.userId, userId))
      .orderBy(asc(t.workspaces.createdAt));
    return rows.map((r) => toWorkspace(r.workspace));
  }

  async update(id: string, patch: Partial<Pick<WorkspaceRecord, 'name' | 'slug'>>) {
    const [row] = await this.db
      .update(t.workspaces)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(t.workspaces.id, id))
      .returning();
    if (!row) throw notFound('Workspace', id);
    return toWorkspace(row);
  }

  async delete(id: string) {
    await this.db.delete(t.workspaces).where(eq(t.workspaces.id, id));
  }
}

class PgMemberRepository implements MemberRepository {
  constructor(private readonly db: Database) {}

  async add(input: Omit<MemberRecord, 'createdAt' | 'updatedAt'>) {
    const existing = await this.find(input.workspaceId, input.userId);
    if (existing) throw conflict('This user is already a member of the workspace.');
    const [row] = await this.db.insert(t.workspaceMembers).values(input).returning();
    return toMember(row!);
  }

  async find(workspaceId: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(t.workspaceMembers)
      .where(
        and(
          eq(t.workspaceMembers.workspaceId, workspaceId),
          eq(t.workspaceMembers.userId, userId),
        ),
      );
    return row ? toMember(row) : null;
  }

  async list(workspaceId: string) {
    const rows = await this.db
      .select()
      .from(t.workspaceMembers)
      .where(eq(t.workspaceMembers.workspaceId, workspaceId))
      .orderBy(asc(t.workspaceMembers.createdAt));
    return rows.map(toMember);
  }

  async updateRole(workspaceId: string, userId: string, role: Role) {
    const [row] = await this.db
      .update(t.workspaceMembers)
      .set({ role, updatedAt: new Date() })
      .where(
        and(
          eq(t.workspaceMembers.workspaceId, workspaceId),
          eq(t.workspaceMembers.userId, userId),
        ),
      )
      .returning();
    if (!row) throw notFound('Workspace member', userId);
    return toMember(row);
  }

  async remove(workspaceId: string, userId: string) {
    await this.db
      .delete(t.workspaceMembers)
      .where(
        and(
          eq(t.workspaceMembers.workspaceId, workspaceId),
          eq(t.workspaceMembers.userId, userId),
        ),
      );
  }
}

class PgPromptRepository implements PromptRepository {
  constructor(private readonly db: Database) {}

  async create(input: Omit<PromptRecord, 'createdAt' | 'updatedAt'>) {
    const [row] = await this.db.insert(t.prompts).values(input).returning();
    return toPrompt(row!);
  }

  async findById(workspaceId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(t.prompts)
      .where(and(eq(t.prompts.id, id), eq(t.prompts.workspaceId, workspaceId)));
    return row ? toPrompt(row) : null;
  }

  async list(workspaceId: string, filter?: PromptFilter) {
    const conditions = [eq(t.prompts.workspaceId, workspaceId)];

    if (filter?.search) {
      const pattern = `%${filter.search.toLowerCase()}%`;
      conditions.push(
        sql`(lower(${t.prompts.name}) like ${pattern} or lower(${t.prompts.description}) like ${pattern})`,
      );
    }
    if (filter?.collection) conditions.push(eq(t.prompts.collection, filter.collection));
    if (filter?.favorite !== undefined) {
      conditions.push(eq(t.prompts.favorite, filter.favorite));
    }
    if (filter?.tags?.length) {
      // `@>` containment against the jsonb array requires every requested tag.
      conditions.push(sql`${t.prompts.tags} @> ${JSON.stringify(filter.tags)}::jsonb`);
    }

    const where = and(...conditions);
    const { limit, offset } = normaliseListOptions(filter);

    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(t.prompts)
        .where(where)
        .orderBy(desc(t.prompts.favorite), desc(t.prompts.updatedAt))
        .limit(limit)
        .offset(offset),
      countRows(this.db, t.prompts, where),
    ]);

    return page(rows.map(toPrompt), total, filter);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: Partial<
      Pick<
        PromptRecord,
        'name' | 'description' | 'collection' | 'tags' | 'favorite' | 'currentVersionId'
      >
    >,
  ) {
    const [row] = await this.db
      .update(t.prompts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(t.prompts.id, id), eq(t.prompts.workspaceId, workspaceId)))
      .returning();
    if (!row) throw notFound('Prompt', id);
    return toPrompt(row);
  }

  async delete(workspaceId: string, id: string) {
    await this.db
      .delete(t.prompts)
      .where(and(eq(t.prompts.id, id), eq(t.prompts.workspaceId, workspaceId)));
  }

  async listCollections(workspaceId: string) {
    const rows = await this.db
      .selectDistinct({ collection: t.prompts.collection })
      .from(t.prompts)
      .where(eq(t.prompts.workspaceId, workspaceId));
    return rows
      .map((r) => r.collection)
      .filter((c): c is string => Boolean(c))
      .sort();
  }

  async listTags(workspaceId: string) {
    const rows = await this.db
      .select({ tags: t.prompts.tags })
      .from(t.prompts)
      .where(eq(t.prompts.workspaceId, workspaceId));

    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, c]) => ({ tag, count: c }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }
}

class PgPromptVersionRepository implements PromptVersionRepository {
  constructor(private readonly db: Database) {}

  async create(input: Omit<PromptVersionRecord, 'createdAt'>) {
    const [row] = await this.db.insert(t.promptVersions).values(input).returning();
    return toVersion(row!);
  }

  async findById(workspaceId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(t.promptVersions)
      .where(
        and(eq(t.promptVersions.id, id), eq(t.promptVersions.workspaceId, workspaceId)),
      );
    return row ? toVersion(row) : null;
  }

  async listForPrompt(workspaceId: string, promptId: string) {
    const rows = await this.db
      .select()
      .from(t.promptVersions)
      .where(
        and(
          eq(t.promptVersions.promptId, promptId),
          eq(t.promptVersions.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(t.promptVersions.version));
    return rows.map(toVersion);
  }

  async latestVersionNumber(promptId: string) {
    const [row] = await this.db
      .select({ max: sql<number>`coalesce(max(${t.promptVersions.version}), 0)` })
      .from(t.promptVersions)
      .where(eq(t.promptVersions.promptId, promptId));
    return Number(row?.max ?? 0);
  }
}

class PgDatasetRepository implements DatasetRepository {
  constructor(private readonly db: Database) {}

  async create(input: Omit<DatasetRecord, 'createdAt' | 'updatedAt'>) {
    const [row] = await this.db.insert(t.datasets).values(input).returning();
    return toDataset(row!);
  }

  async findById(workspaceId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(t.datasets)
      .where(and(eq(t.datasets.id, id), eq(t.datasets.workspaceId, workspaceId)));
    return row ? toDataset(row) : null;
  }

  async list(workspaceId: string, options?: ListOptions) {
    const where = eq(t.datasets.workspaceId, workspaceId);
    const { limit, offset } = normaliseListOptions(options);
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(t.datasets)
        .where(where)
        .orderBy(desc(t.datasets.createdAt))
        .limit(limit)
        .offset(offset),
      countRows(this.db, t.datasets, where),
    ]);
    return page(rows.map(toDataset), total, options);
  }

  async delete(workspaceId: string, id: string) {
    await this.db
      .delete(t.datasets)
      .where(and(eq(t.datasets.id, id), eq(t.datasets.workspaceId, workspaceId)));
  }
}

class PgRubricRepository implements RubricRepository {
  constructor(private readonly db: Database) {}

  async create(input: Omit<RubricRecord, 'createdAt' | 'updatedAt'>) {
    const [row] = await this.db.insert(t.rubrics).values(input).returning();
    return toRubric(row!);
  }

  async findById(workspaceId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(t.rubrics)
      .where(and(eq(t.rubrics.id, id), eq(t.rubrics.workspaceId, workspaceId)));
    return row ? toRubric(row) : null;
  }

  async list(workspaceId: string) {
    const rows = await this.db
      .select()
      .from(t.rubrics)
      .where(eq(t.rubrics.workspaceId, workspaceId))
      .orderBy(desc(t.rubrics.createdAt));
    return rows.map(toRubric);
  }

  async delete(workspaceId: string, id: string) {
    await this.db
      .delete(t.rubrics)
      .where(and(eq(t.rubrics.id, id), eq(t.rubrics.workspaceId, workspaceId)));
  }
}

class PgBenchmarkRepository implements BenchmarkRepository {
  constructor(private readonly db: Database) {}

  async create(input: Omit<BenchmarkRecord, 'createdAt' | 'updatedAt'>) {
    const [row] = await this.db.insert(t.benchmarks).values(input).returning();
    return toBenchmark(row!);
  }

  async findById(workspaceId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(t.benchmarks)
      .where(and(eq(t.benchmarks.id, id), eq(t.benchmarks.workspaceId, workspaceId)));
    return row ? toBenchmark(row) : null;
  }

  async list(workspaceId: string, options?: ListOptions) {
    const where = eq(t.benchmarks.workspaceId, workspaceId);
    const { limit, offset } = normaliseListOptions(options);
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(t.benchmarks)
        .where(where)
        .orderBy(desc(t.benchmarks.createdAt))
        .limit(limit)
        .offset(offset),
      countRows(this.db, t.benchmarks, where),
    ]);
    return page(rows.map(toBenchmark), total, options);
  }

  async delete(workspaceId: string, id: string) {
    await this.db
      .delete(t.benchmarks)
      .where(and(eq(t.benchmarks.id, id), eq(t.benchmarks.workspaceId, workspaceId)));
  }
}

class PgRunRepository implements RunRepository {
  constructor(private readonly db: Database) {}

  async create(input: Omit<RunRecord, 'createdAt' | 'updatedAt'>) {
    const [row] = await this.db
      .insert(t.benchmarkRuns)
      .values({
        ...input,
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        finishedAt: input.finishedAt ? new Date(input.finishedAt) : null,
      })
      .returning();
    return toRun(row!);
  }

  async findById(workspaceId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(t.benchmarkRuns)
      .where(
        and(eq(t.benchmarkRuns.id, id), eq(t.benchmarkRuns.workspaceId, workspaceId)),
      );
    return row ? toRun(row) : null;
  }

  async list(
    workspaceId: string,
    options?: ListOptions & { benchmarkId?: string; status?: RunStatus },
  ) {
    const conditions = [eq(t.benchmarkRuns.workspaceId, workspaceId)];
    if (options?.benchmarkId) {
      conditions.push(eq(t.benchmarkRuns.benchmarkId, options.benchmarkId));
    }
    if (options?.status) conditions.push(eq(t.benchmarkRuns.status, options.status));

    const where = and(...conditions);
    const { limit, offset } = normaliseListOptions(options);
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(t.benchmarkRuns)
        .where(where)
        .orderBy(desc(t.benchmarkRuns.createdAt))
        .limit(limit)
        .offset(offset),
      countRows(this.db, t.benchmarkRuns, where),
    ]);
    return page(rows.map(toRun), total, options);
  }

  async update(id: string, patch: Partial<RunRecord>) {
    const { startedAt, finishedAt, createdAt: _c, updatedAt: _u, ...rest } = patch;
    const [row] = await this.db
      .update(t.benchmarkRuns)
      .set({
        ...rest,
        ...(startedAt !== undefined
          ? { startedAt: startedAt ? new Date(startedAt) : null }
          : {}),
        ...(finishedAt !== undefined
          ? { finishedAt: finishedAt ? new Date(finishedAt) : null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(t.benchmarkRuns.id, id))
      .returning();
    if (!row) throw notFound('Run', id);
    return toRun(row);
  }

  async delete(workspaceId: string, id: string) {
    await this.db
      .delete(t.benchmarkRuns)
      .where(
        and(eq(t.benchmarkRuns.id, id), eq(t.benchmarkRuns.workspaceId, workspaceId)),
      );
  }
}

class PgRunResultRepository implements RunResultRepository {
  constructor(private readonly db: Database) {}

  async createMany(rows: Array<Omit<RunResultRecord, 'createdAt'>>) {
    if (rows.length === 0) return [];
    // Chunked so a large dataset run does not exceed the parameter limit.
    const CHUNK = 250;
    const inserted: RunResultRecord[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = await this.db
        .insert(t.runResults)
        .values(rows.slice(i, i + CHUNK))
        .returning();
      inserted.push(...batch.map(toResult));
    }
    return inserted;
  }

  async listForRun(workspaceId: string, runId: string) {
    const rows = await this.db
      .select()
      .from(t.runResults)
      .where(
        and(eq(t.runResults.runId, runId), eq(t.runResults.workspaceId, workspaceId)),
      )
      .orderBy(asc(t.runResults.caseIndex), asc(t.runResults.modelId));
    return rows.map(toResult);
  }

  async listForWorkspace(workspaceId: string, options?: ListOptions) {
    const rows = await this.db
      .select()
      .from(t.runResults)
      .where(eq(t.runResults.workspaceId, workspaceId))
      .orderBy(desc(t.runResults.createdAt))
      .limit(options?.limit ?? 1000)
      .offset(options?.offset ?? 0);
    return rows.map(toResult);
  }
}

class PgCommentRepository implements CommentRepository {
  constructor(private readonly db: Database) {}

  async create(input: Omit<CommentRecord, 'createdAt' | 'updatedAt'>) {
    const [row] = await this.db.insert(t.comments).values(input).returning();
    return toComment(row!);
  }

  async listForTarget(workspaceId: string, targetType: CommentTarget, targetId: string) {
    const rows = await this.db
      .select()
      .from(t.comments)
      .where(
        and(
          eq(t.comments.workspaceId, workspaceId),
          eq(t.comments.targetType, targetType),
          eq(t.comments.targetId, targetId),
        ),
      )
      .orderBy(asc(t.comments.createdAt));
    return rows.map(toComment);
  }

  async delete(workspaceId: string, id: string) {
    await this.db
      .delete(t.comments)
      .where(and(eq(t.comments.id, id), eq(t.comments.workspaceId, workspaceId)));
  }
}

class PgApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: Database) {}

  async create(input: Omit<ApiKeyRecord, 'createdAt' | 'updatedAt'>) {
    const [row] = await this.db
      .insert(t.apiKeys)
      .values({
        ...input,
        lastUsedAt: input.lastUsedAt ? new Date(input.lastUsedAt) : null,
        revokedAt: input.revokedAt ? new Date(input.revokedAt) : null,
      })
      .returning();
    return toApiKey(row!);
  }

  async findByHash(keyHash: string) {
    const [row] = await this.db
      .select()
      .from(t.apiKeys)
      .where(eq(t.apiKeys.keyHash, keyHash));
    return row ? toApiKey(row) : null;
  }

  async list(workspaceId: string) {
    const rows = await this.db
      .select()
      .from(t.apiKeys)
      .where(eq(t.apiKeys.workspaceId, workspaceId))
      .orderBy(desc(t.apiKeys.createdAt));
    return rows.map(toApiKey);
  }

  async touch(id: string) {
    await this.db
      .update(t.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(t.apiKeys.id, id));
  }

  async revoke(workspaceId: string, id: string) {
    await this.db
      .update(t.apiKeys)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(t.apiKeys.id, id), eq(t.apiKeys.workspaceId, workspaceId)));
  }
}

export class PostgresRepositories implements Repositories {
  readonly workspaces: WorkspaceRepository;
  readonly members: MemberRepository;
  readonly prompts: PromptRepository;
  readonly promptVersions: PromptVersionRepository;
  readonly datasets: DatasetRepository;
  readonly rubrics: RubricRepository;
  readonly benchmarks: BenchmarkRepository;
  readonly runs: RunRepository;
  readonly runResults: RunResultRepository;
  readonly comments: CommentRepository;
  readonly apiKeys: ApiKeyRepository;

  constructor(db: Database) {
    this.workspaces = new PgWorkspaceRepository(db);
    this.members = new PgMemberRepository(db);
    this.prompts = new PgPromptRepository(db);
    this.promptVersions = new PgPromptVersionRepository(db);
    this.datasets = new PgDatasetRepository(db);
    this.rubrics = new PgRubricRepository(db);
    this.benchmarks = new PgBenchmarkRepository(db);
    this.runs = new PgRunRepository(db);
    this.runResults = new PgRunResultRepository(db);
    this.comments = new PgCommentRepository(db);
    this.apiKeys = new PgApiKeyRepository(db);
  }
}

export { inArray };
