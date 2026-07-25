import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepositories } from '@/lib/db/memory';
import { normaliseListOptions, paginate } from '@/lib/db/repositories';
import { newId } from '@/lib/core/id';
import { DEFAULT_COMPLETION_PARAMS } from '@/lib/core/types';
import type { Repositories } from '@/lib/db/repositories';

/**
 * Repository conformance suite.
 *
 * Written against the `Repositories` interface rather than a concrete class, so
 * the same assertions can be pointed at the Postgres driver by supplying a
 * different factory. That is what keeps the in-memory driver a faithful test
 * double rather than a second implementation that quietly diverges.
 */
function conformanceSuite(name: string, factory: () => Repositories) {
  describe(name, () => {
    let repos: Repositories;
    const WS = 'ws_test0000000000000a';
    const OTHER_WS = 'ws_test0000000000000b';

    beforeEach(async () => {
      repos = factory();
      await repos.workspaces.create({
        id: WS,
        name: 'Test',
        slug: 'test',
        externalId: null,
      });
      await repos.workspaces.create({
        id: OTHER_WS,
        name: 'Other',
        slug: 'other',
        externalId: null,
      });
    });

    const makePrompt = (
      overrides: Partial<Parameters<typeof repos.prompts.create>[0]> = {},
    ) =>
      repos.prompts.create({
        id: newId('prompt'),
        workspaceId: WS,
        name: 'Prompt',
        description: '',
        collection: null,
        tags: [],
        favorite: false,
        currentVersionId: null,
        createdBy: 'user_1',
        ...overrides,
      });

    describe('workspaces', () => {
      it('rejects a duplicate slug', async () => {
        await expect(
          repos.workspaces.create({
            id: newId('ws'),
            name: 'Dup',
            slug: 'test',
            externalId: null,
          }),
        ).rejects.toThrow(/already taken/i);
      });

      it('finds by slug and external id', async () => {
        await repos.workspaces.create({
          id: newId('ws'),
          name: 'Ext',
          slug: 'ext',
          externalId: 'org_123',
        });

        expect((await repos.workspaces.findBySlug('ext'))?.name).toBe('Ext');
        expect((await repos.workspaces.findByExternalId('org_123'))?.slug).toBe('ext');
      });

      it('lists only workspaces the user is a member of', async () => {
        await repos.members.add({
          id: newId('user'),
          workspaceId: WS,
          userId: 'u1',
          email: 'u1@x',
          displayName: 'U1',
          role: 'owner',
        });

        const list = await repos.workspaces.listForUser('u1');
        expect(list.map((w) => w.id)).toEqual([WS]);
      });

      it('returns null for an unknown id rather than throwing', async () => {
        expect(await repos.workspaces.findById('ws_nope0000000000000x')).toBeNull();
      });
    });

    describe('members', () => {
      it('rejects adding the same user twice', async () => {
        const member = {
          id: newId('user'),
          workspaceId: WS,
          userId: 'dup',
          email: 'd@x',
          displayName: 'D',
          role: 'editor' as const,
        };
        await repos.members.add(member);
        await expect(
          repos.members.add({ ...member, id: newId('user') }),
        ).rejects.toThrow();
      });

      it('updates a role', async () => {
        await repos.members.add({
          id: newId('user'),
          workspaceId: WS,
          userId: 'u',
          email: 'u@x',
          displayName: 'U',
          role: 'viewer',
        });

        const updated = await repos.members.updateRole(WS, 'u', 'admin');
        expect(updated.role).toBe('admin');
      });

      it('throws when updating a role for a non-member', async () => {
        await expect(repos.members.updateRole(WS, 'ghost', 'admin')).rejects.toThrow();
      });
    });

    describe('tenant isolation', () => {
      it('does not return another workspace record by id', async () => {
        const prompt = await makePrompt();
        expect(await repos.prompts.findById(OTHER_WS, prompt.id)).toBeNull();
      });

      it('does not list another workspace records', async () => {
        await makePrompt();
        const page = await repos.prompts.list(OTHER_WS);
        expect(page.total).toBe(0);
      });

      it('refuses to update across a workspace boundary', async () => {
        const prompt = await makePrompt();
        await expect(
          repos.prompts.update(OTHER_WS, prompt.id, { name: 'Hijacked' }),
        ).rejects.toThrow();
      });

      it('is a no-op when deleting across a workspace boundary', async () => {
        const prompt = await makePrompt();
        await repos.prompts.delete(OTHER_WS, prompt.id);
        expect(await repos.prompts.findById(WS, prompt.id)).not.toBeNull();
      });
    });

    describe('prompts', () => {
      it('filters by search across name, description and tags', async () => {
        await makePrompt({ name: 'Triage classifier' });
        await makePrompt({ name: 'Other', description: 'about triage' });
        await makePrompt({ name: 'Unrelated' });

        const page = await repos.prompts.list(WS, { search: 'triage' });
        expect(page.total).toBe(2);
      });

      it('requires every requested tag, not any', async () => {
        await makePrompt({ name: 'Both', tags: ['a', 'b'] });
        await makePrompt({ name: 'One', tags: ['a'] });

        const page = await repos.prompts.list(WS, { tags: ['a', 'b'] });
        expect(page.items.map((p) => p.name)).toEqual(['Both']);
      });

      it('filters by collection and favourite', async () => {
        await makePrompt({ name: 'Fav', favorite: true, collection: 'Eng' });
        await makePrompt({ name: 'Plain' });

        expect((await repos.prompts.list(WS, { favorite: true })).total).toBe(1);
        expect((await repos.prompts.list(WS, { collection: 'Eng' })).total).toBe(1);
      });

      it('floats favourites to the top', async () => {
        await makePrompt({ name: 'Plain' });
        await makePrompt({ name: 'Fav', favorite: true });

        const page = await repos.prompts.list(WS);
        expect(page.items[0]?.name).toBe('Fav');
      });

      it('aggregates tags with counts, most used first', async () => {
        await makePrompt({ tags: ['common', 'rare'] });
        await makePrompt({ tags: ['common'] });

        const tags = await repos.prompts.listTags(WS);
        expect(tags[0]).toEqual({ tag: 'common', count: 2 });
      });

      it('lists distinct collections, excluding nulls', async () => {
        await makePrompt({ collection: 'Eng' });
        await makePrompt({ collection: 'Eng' });
        await makePrompt({ collection: null });

        expect(await repos.prompts.listCollections(WS)).toEqual(['Eng']);
      });

      it('paginates with a stable total', async () => {
        for (let i = 0; i < 7; i++) await makePrompt({ name: `P${i}` });

        const page = await repos.prompts.list(WS, { limit: 3, offset: 3 });
        expect(page.items).toHaveLength(3);
        expect(page.total).toBe(7);
        expect(page.offset).toBe(3);
      });
    });

    describe('prompt versions', () => {
      it('tracks the highest version number per prompt', async () => {
        const prompt = await makePrompt();
        expect(await repos.promptVersions.latestVersionNumber(prompt.id)).toBe(0);

        for (const version of [1, 2, 3]) {
          await repos.promptVersions.create({
            id: newId('ver'),
            promptId: prompt.id,
            workspaceId: WS,
            version,
            template: `v${version}`,
            systemPrompt: '',
            params: DEFAULT_COMPLETION_PARAMS,
            changeNote: '',
            createdBy: 'u',
          });
        }

        expect(await repos.promptVersions.latestVersionNumber(prompt.id)).toBe(3);
      });

      it('lists versions newest first', async () => {
        const prompt = await makePrompt();
        for (const version of [1, 2, 3]) {
          await repos.promptVersions.create({
            id: newId('ver'),
            promptId: prompt.id,
            workspaceId: WS,
            version,
            template: '',
            systemPrompt: '',
            params: DEFAULT_COMPLETION_PARAMS,
            changeNote: '',
            createdBy: 'u',
          });
        }

        const versions = await repos.promptVersions.listForPrompt(WS, prompt.id);
        expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
      });
    });

    describe('api keys', () => {
      it('looks a key up by hash and marks it used', async () => {
        const key = await repos.apiKeys.create({
          id: newId('key'),
          workspaceId: WS,
          name: 'CI',
          keyHash: 'deadbeef',
          keyPrefix: 'pb_dead',
          lastUsedAt: null,
          revokedAt: null,
          createdBy: 'u',
        });

        expect((await repos.apiKeys.findByHash('deadbeef'))?.id).toBe(key.id);

        await repos.apiKeys.touch(key.id);
        const list = await repos.apiKeys.list(WS);
        expect(list[0]?.lastUsedAt).not.toBeNull();
      });

      it('soft-deletes on revoke so the audit trail survives', async () => {
        const key = await repos.apiKeys.create({
          id: newId('key'),
          workspaceId: WS,
          name: 'Old',
          keyHash: 'cafe',
          keyPrefix: 'pb_cafe',
          lastUsedAt: null,
          revokedAt: null,
          createdBy: 'u',
        });

        await repos.apiKeys.revoke(WS, key.id);
        const found = await repos.apiKeys.findByHash('cafe');

        expect(found).not.toBeNull();
        expect(found?.revokedAt).not.toBeNull();
      });
    });

    describe('run results', () => {
      it('bulk-inserts and returns rows ordered by case then model', async () => {
        const benchmark = await repos.benchmarks.create({
          id: newId('bench'),
          workspaceId: WS,
          name: 'B',
          description: '',
          promptId: null,
          promptVersionId: null,
          datasetId: null,
          modelIds: ['m1', 'm2'],
          rubricId: null,
          judgeModelId: null,
          params: DEFAULT_COMPLETION_PARAMS,
          createdBy: 'u',
        });

        const run = await repos.runs.create({
          id: newId('run'),
          benchmarkId: benchmark.id,
          workspaceId: WS,
          status: 'running',
          promptTemplate: 't',
          systemPrompt: '',
          modelIds: ['m1', 'm2'],
          summary: null,
          totalCostUsd: 0,
          totalTokens: 0,
          avgLatencyMs: 0,
          caseCount: 2,
          errorMessage: null,
          startedAt: null,
          finishedAt: null,
          createdBy: 'u',
        });

        const completion = {
          modelId: 'm',
          provider: 'openai' as const,
          resolvedModel: 'm',
          content: 'x',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cachedInputTokens: 0,
            totalTokens: 2,
          },
          cost: { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 },
          latencyMs: 10,
          timeToFirstTokenMs: null,
          finishReason: 'stop' as const,
        };

        await repos.runResults.createMany([
          {
            id: newId('row'),
            runId: run.id,
            workspaceId: WS,
            modelId: 'm2',
            caseIndex: 1,
            variables: {},
            completion,
            evaluation: null,
            score: null,
            latencyMs: 10,
            costUsd: 0,
            totalTokens: 2,
          },
          {
            id: newId('row'),
            runId: run.id,
            workspaceId: WS,
            modelId: 'm1',
            caseIndex: 0,
            variables: {},
            completion,
            evaluation: null,
            score: null,
            latencyMs: 10,
            costUsd: 0,
            totalTokens: 2,
          },
        ]);

        const rows = await repos.runResults.listForRun(WS, run.id);
        expect(rows.map((r) => [r.caseIndex, r.modelId])).toEqual([
          [0, 'm1'],
          [1, 'm2'],
        ]);
      });

      it('accepts an empty batch', async () => {
        expect(await repos.runResults.createMany([])).toEqual([]);
      });
    });

    describe('mutation safety', () => {
      it('does not let a caller mutate stored state via a returned object', async () => {
        const prompt = await makePrompt({ tags: ['original'] });
        prompt.tags.push('injected');
        prompt.name = 'Renamed';

        const fresh = await repos.prompts.findById(WS, prompt.id);
        expect(fresh?.tags).toEqual(['original']);
        expect(fresh?.name).toBe('Prompt');
      });
    });
  });
}

conformanceSuite('MemoryRepositories', () => new MemoryRepositories());

describe('pagination helpers', () => {
  it('applies defaults and clamps to the maximum', () => {
    expect(normaliseListOptions().limit).toBe(50);
    expect(normaliseListOptions({ limit: 10_000 }).limit).toBe(200);
    expect(normaliseListOptions({ limit: 0 }).limit).toBe(1);
    expect(normaliseListOptions({ offset: -5 }).offset).toBe(0);
  });

  it('slices while reporting the untruncated total', () => {
    const page = paginate([1, 2, 3, 4, 5], { limit: 2, offset: 1 });
    expect(page.items).toEqual([2, 3]);
    expect(page.total).toBe(5);
  });

  it('returns an empty slice past the end', () => {
    expect(paginate([1, 2], { offset: 99 }).items).toEqual([]);
  });
});
