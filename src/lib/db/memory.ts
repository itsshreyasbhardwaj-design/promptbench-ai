import { conflict, notFound } from '@/lib/core/errors';
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
import { paginate } from '@/lib/db/repositories';

/**
 * In-memory persistence driver.
 *
 * This is the default when `DATABASE_URL` is unset, and it is the driver the
 * whole test suite runs against. It is a genuine implementation of the contract
 * — same validation, same tenant scoping, same ordering guarantees — not a
 * stub, which is what makes it trustworthy as a test double.
 *
 * Records are deep-cloned on the way in and out. Without that, a caller
 * mutating a returned object would silently corrupt the store, and tests would
 * pass against behaviour Postgres does not have.
 */

const clone = <T>(value: T): T => structuredClone(value);

const now = () => new Date().toISOString();

/** Newest-first comparator on an ISO timestamp field. */
function byNewest<T extends { createdAt: string }>(a: T, b: T): number {
  return b.createdAt.localeCompare(a.createdAt);
}

class Table<T extends { id: string }> {
  protected readonly rows = new Map<string, T>();

  insert(record: T): T {
    if (this.rows.has(record.id)) {
      throw conflict(`Record "${record.id}" already exists.`);
    }
    this.rows.set(record.id, clone(record));
    return clone(record);
  }

  get(id: string): T | null {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  all(): T[] {
    return [...this.rows.values()].map(clone);
  }

  patch(id: string, patch: Partial<T>, label: string): T {
    const existing = this.rows.get(id);
    if (!existing) throw notFound(label, id);
    const updated = { ...existing, ...clone(patch), id: existing.id } as T;
    this.rows.set(id, updated);
    return clone(updated);
  }

  remove(id: string): void {
    this.rows.delete(id);
  }

  clear(): void {
    this.rows.clear();
  }
}

class MemoryWorkspaceRepository implements WorkspaceRepository {
  constructor(
    private readonly table: Table<WorkspaceRecord>,
    private readonly members: Table<MemberRecord>,
  ) {}

  async create(input: Omit<WorkspaceRecord, 'createdAt' | 'updatedAt'>) {
    const existing = this.table.all().find((w) => w.slug === input.slug);
    if (existing) throw conflict(`Workspace slug "${input.slug}" is already taken.`);
    return this.table.insert({ ...input, createdAt: now(), updatedAt: now() });
  }

  async findById(id: string) {
    return this.table.get(id);
  }

  async findBySlug(slug: string) {
    return this.table.all().find((w) => w.slug === slug) ?? null;
  }

  async findByExternalId(externalId: string) {
    return this.table.all().find((w) => w.externalId === externalId) ?? null;
  }

  async listForUser(userId: string) {
    const workspaceIds = new Set(
      this.members
        .all()
        .filter((m) => m.userId === userId)
        .map((m) => m.workspaceId),
    );
    return this.table
      .all()
      .filter((w) => workspaceIds.has(w.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async update(id: string, patch: Partial<Pick<WorkspaceRecord, 'name' | 'slug'>>) {
    return this.table.patch(id, { ...patch, updatedAt: now() }, 'Workspace');
  }

  async delete(id: string) {
    this.table.remove(id);
  }
}

class MemoryMemberRepository implements MemberRepository {
  constructor(private readonly table: Table<MemberRecord>) {}

  async add(input: Omit<MemberRecord, 'createdAt' | 'updatedAt'>) {
    const duplicate = this.table
      .all()
      .find((m) => m.workspaceId === input.workspaceId && m.userId === input.userId);
    if (duplicate) throw conflict('This user is already a member of the workspace.');
    return this.table.insert({ ...input, createdAt: now(), updatedAt: now() });
  }

  async find(workspaceId: string, userId: string) {
    return (
      this.table
        .all()
        .find((m) => m.workspaceId === workspaceId && m.userId === userId) ?? null
    );
  }

  async list(workspaceId: string) {
    return this.table
      .all()
      .filter((m) => m.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateRole(workspaceId: string, userId: string, role: MemberRecord['role']) {
    const member = await this.find(workspaceId, userId);
    if (!member) throw notFound('Workspace member', userId);
    return this.table.patch(member.id, { role, updatedAt: now() }, 'Workspace member');
  }

  async remove(workspaceId: string, userId: string) {
    const member = await this.find(workspaceId, userId);
    if (member) this.table.remove(member.id);
  }
}

class MemoryPromptRepository implements PromptRepository {
  constructor(private readonly table: Table<PromptRecord>) {}

  async create(input: Omit<PromptRecord, 'createdAt' | 'updatedAt'>) {
    return this.table.insert({ ...input, createdAt: now(), updatedAt: now() });
  }

  async findById(workspaceId: string, id: string) {
    const row = this.table.get(id);
    return row && row.workspaceId === workspaceId ? row : null;
  }

  async list(workspaceId: string, filter?: PromptFilter): Promise<Page<PromptRecord>> {
    let items = this.table.all().filter((p) => p.workspaceId === workspaceId);

    if (filter?.search) {
      const q = filter.search.toLowerCase();
      items = items.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (filter?.tags?.length) {
      // Require every requested tag, which is the useful semantic for narrowing.
      items = items.filter((p) => filter.tags!.every((t) => p.tags.includes(t)));
    }
    if (filter?.collection) {
      items = items.filter((p) => p.collection === filter.collection);
    }
    if (filter?.favorite !== undefined) {
      items = items.filter((p) => p.favorite === filter.favorite);
    }

    // Favourites float to the top, then most recently updated.
    items.sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt),
    );
    return paginate(items, filter);
  }

  async update(workspaceId: string, id: string, patch: Partial<PromptRecord>) {
    const existing = await this.findById(workspaceId, id);
    if (!existing) throw notFound('Prompt', id);
    return this.table.patch(id, { ...patch, updatedAt: now() }, 'Prompt');
  }

  async delete(workspaceId: string, id: string) {
    const existing = await this.findById(workspaceId, id);
    if (existing) this.table.remove(id);
  }

  async listCollections(workspaceId: string) {
    return [
      ...new Set(
        this.table
          .all()
          .filter((p) => p.workspaceId === workspaceId && p.collection)
          .map((p) => p.collection!),
      ),
    ].sort();
  }

  async listTags(workspaceId: string) {
    const counts = new Map<string, number>();
    for (const prompt of this.table.all()) {
      if (prompt.workspaceId !== workspaceId) continue;
      for (const tag of prompt.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }
}

class MemoryPromptVersionRepository implements PromptVersionRepository {
  constructor(private readonly table: Table<PromptVersionRecord>) {}

  async create(input: Omit<PromptVersionRecord, 'createdAt'>) {
    return this.table.insert({ ...input, createdAt: now() });
  }

  async findById(workspaceId: string, id: string) {
    const row = this.table.get(id);
    return row && row.workspaceId === workspaceId ? row : null;
  }

  async listForPrompt(workspaceId: string, promptId: string) {
    return this.table
      .all()
      .filter((v) => v.workspaceId === workspaceId && v.promptId === promptId)
      .sort((a, b) => b.version - a.version);
  }

  async latestVersionNumber(promptId: string) {
    const versions = this.table.all().filter((v) => v.promptId === promptId);
    return versions.reduce((max, v) => Math.max(max, v.version), 0);
  }
}

class MemoryDatasetRepository implements DatasetRepository {
  constructor(private readonly table: Table<DatasetRecord>) {}

  async create(input: Omit<DatasetRecord, 'createdAt' | 'updatedAt'>) {
    return this.table.insert({ ...input, createdAt: now(), updatedAt: now() });
  }

  async findById(workspaceId: string, id: string) {
    const row = this.table.get(id);
    return row && row.workspaceId === workspaceId ? row : null;
  }

  async list(workspaceId: string, options?: ListOptions) {
    const items = this.table
      .all()
      .filter((d) => d.workspaceId === workspaceId)
      .sort(byNewest);
    return paginate(items, options);
  }

  async delete(workspaceId: string, id: string) {
    const existing = await this.findById(workspaceId, id);
    if (existing) this.table.remove(id);
  }
}

class MemoryRubricRepository implements RubricRepository {
  constructor(private readonly table: Table<RubricRecord>) {}

  async create(input: Omit<RubricRecord, 'createdAt' | 'updatedAt'>) {
    return this.table.insert({ ...input, createdAt: now(), updatedAt: now() });
  }

  async findById(workspaceId: string, id: string) {
    const row = this.table.get(id);
    return row && row.workspaceId === workspaceId ? row : null;
  }

  async list(workspaceId: string) {
    return this.table
      .all()
      .filter((r) => r.workspaceId === workspaceId)
      .sort(byNewest);
  }

  async delete(workspaceId: string, id: string) {
    const existing = await this.findById(workspaceId, id);
    if (existing) this.table.remove(id);
  }
}

class MemoryBenchmarkRepository implements BenchmarkRepository {
  constructor(private readonly table: Table<BenchmarkRecord>) {}

  async create(input: Omit<BenchmarkRecord, 'createdAt' | 'updatedAt'>) {
    return this.table.insert({ ...input, createdAt: now(), updatedAt: now() });
  }

  async findById(workspaceId: string, id: string) {
    const row = this.table.get(id);
    return row && row.workspaceId === workspaceId ? row : null;
  }

  async list(workspaceId: string, options?: ListOptions) {
    const items = this.table
      .all()
      .filter((b) => b.workspaceId === workspaceId)
      .sort(byNewest);
    return paginate(items, options);
  }

  async delete(workspaceId: string, id: string) {
    const existing = await this.findById(workspaceId, id);
    if (existing) this.table.remove(id);
  }
}

class MemoryRunRepository implements RunRepository {
  constructor(private readonly table: Table<RunRecord>) {}

  async create(input: Omit<RunRecord, 'createdAt' | 'updatedAt'>) {
    return this.table.insert({ ...input, createdAt: now(), updatedAt: now() });
  }

  async findById(workspaceId: string, id: string) {
    const row = this.table.get(id);
    return row && row.workspaceId === workspaceId ? row : null;
  }

  async list(
    workspaceId: string,
    options?: ListOptions & { benchmarkId?: string; status?: RunRecord['status'] },
  ) {
    let items = this.table.all().filter((r) => r.workspaceId === workspaceId);
    if (options?.benchmarkId) {
      items = items.filter((r) => r.benchmarkId === options.benchmarkId);
    }
    if (options?.status) items = items.filter((r) => r.status === options.status);
    return paginate(items.sort(byNewest), options);
  }

  async update(id: string, patch: Partial<RunRecord>) {
    return this.table.patch(id, { ...patch, updatedAt: now() }, 'Run');
  }

  async delete(workspaceId: string, id: string) {
    const existing = await this.findById(workspaceId, id);
    if (existing) this.table.remove(id);
  }
}

class MemoryRunResultRepository implements RunResultRepository {
  constructor(private readonly table: Table<RunResultRecord>) {}

  async createMany(rows: Array<Omit<RunResultRecord, 'createdAt'>>) {
    const timestamp = now();
    return rows.map((row) => this.table.insert({ ...row, createdAt: timestamp }));
  }

  async listForRun(workspaceId: string, runId: string) {
    return this.table
      .all()
      .filter((r) => r.workspaceId === workspaceId && r.runId === runId)
      .sort((a, b) => a.caseIndex - b.caseIndex || a.modelId.localeCompare(b.modelId));
  }

  async listForWorkspace(workspaceId: string, options?: ListOptions) {
    const { limit, offset } = {
      limit: options?.limit ?? 1000,
      offset: options?.offset ?? 0,
    };
    return this.table
      .all()
      .filter((r) => r.workspaceId === workspaceId)
      .sort(byNewest)
      .slice(offset, offset + limit);
  }
}

class MemoryCommentRepository implements CommentRepository {
  constructor(private readonly table: Table<CommentRecord>) {}

  async create(input: Omit<CommentRecord, 'createdAt' | 'updatedAt'>) {
    return this.table.insert({ ...input, createdAt: now(), updatedAt: now() });
  }

  async listForTarget(workspaceId: string, targetType: CommentTarget, targetId: string) {
    return this.table
      .all()
      .filter(
        (c) =>
          c.workspaceId === workspaceId &&
          c.targetType === targetType &&
          c.targetId === targetId,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async delete(workspaceId: string, id: string) {
    const row = this.table.get(id);
    if (row && row.workspaceId === workspaceId) this.table.remove(id);
  }
}

class MemoryApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly table: Table<ApiKeyRecord>) {}

  async create(input: Omit<ApiKeyRecord, 'createdAt' | 'updatedAt'>) {
    return this.table.insert({ ...input, createdAt: now(), updatedAt: now() });
  }

  async findByHash(keyHash: string) {
    return this.table.all().find((k) => k.keyHash === keyHash) ?? null;
  }

  async list(workspaceId: string) {
    return this.table
      .all()
      .filter((k) => k.workspaceId === workspaceId)
      .sort(byNewest);
  }

  async touch(id: string) {
    if (this.table.get(id)) this.table.patch(id, { lastUsedAt: now() }, 'API key');
  }

  async revoke(workspaceId: string, id: string) {
    const row = this.table.get(id);
    if (row && row.workspaceId === workspaceId) {
      this.table.patch(id, { revokedAt: now(), updatedAt: now() }, 'API key');
    }
  }
}

export class MemoryRepositories implements Repositories {
  private readonly tables = {
    workspaces: new Table<WorkspaceRecord>(),
    members: new Table<MemberRecord>(),
    prompts: new Table<PromptRecord>(),
    promptVersions: new Table<PromptVersionRecord>(),
    datasets: new Table<DatasetRecord>(),
    rubrics: new Table<RubricRecord>(),
    benchmarks: new Table<BenchmarkRecord>(),
    runs: new Table<RunRecord>(),
    runResults: new Table<RunResultRecord>(),
    comments: new Table<CommentRecord>(),
    apiKeys: new Table<ApiKeyRecord>(),
  };

  readonly workspaces = new MemoryWorkspaceRepository(
    this.tables.workspaces,
    this.tables.members,
  );
  readonly members = new MemoryMemberRepository(this.tables.members);
  readonly prompts = new MemoryPromptRepository(this.tables.prompts);
  readonly promptVersions = new MemoryPromptVersionRepository(this.tables.promptVersions);
  readonly datasets = new MemoryDatasetRepository(this.tables.datasets);
  readonly rubrics = new MemoryRubricRepository(this.tables.rubrics);
  readonly benchmarks = new MemoryBenchmarkRepository(this.tables.benchmarks);
  readonly runs = new MemoryRunRepository(this.tables.runs);
  readonly runResults = new MemoryRunResultRepository(this.tables.runResults);
  readonly comments = new MemoryCommentRepository(this.tables.comments);
  readonly apiKeys = new MemoryApiKeyRepository(this.tables.apiKeys);

  /** Drops all data. Used between tests and by the seeder. */
  reset(): void {
    for (const table of Object.values(this.tables)) table.clear();
  }
}
