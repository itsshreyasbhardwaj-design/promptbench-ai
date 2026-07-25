import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepositories } from '@/lib/db/memory';
import { resetRepositories, setRepositories } from '@/lib/db';
import { getRateLimitStore } from '@/lib/api/rate-limit';
import { GET as getModels } from '@/app/api/v1/models/route';
import { GET as getHealth } from '@/app/api/v1/health/route';
import { GET as getRubrics } from '@/app/api/v1/rubrics/route';
import { GET as listPrompts, POST as createPrompt } from '@/app/api/v1/prompts/route';
import {
  GET as getPrompt,
  PATCH as patchPrompt,
  DELETE as deletePrompt,
} from '@/app/api/v1/prompts/[id]/route';
import {
  GET as listVersions,
  POST as createVersion,
  PUT as rollback,
} from '@/app/api/v1/prompts/[id]/versions/route';
import { POST as createDataset } from '@/app/api/v1/datasets/route';
import { POST as runBenchmark } from '@/app/api/v1/benchmarks/route';
import { GET as getRun } from '@/app/api/v1/runs/[id]/route';
import { GET as getReport } from '@/app/api/v1/runs/[id]/report/route';
import { POST as evaluateRoute } from '@/app/api/v1/evaluate/route';

/**
 * API integration tests.
 *
 * These drive the real exported route handlers — including auth resolution,
 * validation, permission checks and the error envelope — against the in-memory
 * driver. Nothing is mocked below the HTTP boundary, so a regression anywhere
 * in that stack surfaces here.
 */

const BASE = 'http://localhost/api/v1';

function post(path: string, body: unknown): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`${BASE}${path}`);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function json<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const validParams = { temperature: 0.5, maxTokens: 128, topP: 1 };

beforeEach(async () => {
  resetRepositories();
  setRepositories(new MemoryRepositories());
  // Rate limits are per-identity and persist across tests otherwise.
  await getRateLimitStore().reset();
});

describe('GET /models', () => {
  it('returns the catalog with provider metadata', async () => {
    const body = await json(await getModels(get('/models')));

    expect(body.data.models.length).toBeGreaterThan(0);
    expect(body.data.providers.length).toBeGreaterThanOrEqual(9);
    expect(body.data.catalogVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.data.liveModels).toBe(false);
  });

  it('filters by provider', async () => {
    const body = await json(await getModels(get('/models?provider=anthropic')));
    expect(body.data.models.every((m: any) => m.provider === 'anthropic')).toBe(true);
  });

  it('filters by search across name and provider', async () => {
    const body = await json(await getModels(get('/models?search=haiku')));
    expect(body.data.models.length).toBeGreaterThan(0);
    expect(body.data.models[0].name.toLowerCase()).toContain('haiku');
  });

  it('filters to judge-capable models', async () => {
    const body = await json(await getModels(get('/models?judgeCapable=true')));
    expect(body.data.models.every((m: any) => m.judgeCapable)).toBe(true);
  });
});

describe('GET /health', () => {
  it('reports mode and capabilities without leaking secrets', async () => {
    const body = await json(getHealth());

    expect(body.status).toBe('ok');
    expect(body.mode).toBe('local');
    expect(body.capabilities).toEqual({
      liveModels: false,
      persistentStorage: false,
      managedAuth: false,
    });

    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/sk-|postgres:|secret/i);
  });
});

describe('GET /rubrics', () => {
  it('flags which rubrics cost money to run', async () => {
    const body = await json(await getRubrics(get('/rubrics')));

    const fast = body.data.rubrics.find((r: any) => r.id === 'fast-heuristic');
    const general = body.data.rubrics.find((r: any) => r.id === 'general-quality');

    expect(fast.costsMoney).toBe(false);
    expect(fast.judgeCriteriaCount).toBe(0);
    expect(general.costsMoney).toBe(true);
    expect(body.data.criteria.length).toBe(10);
  });
});

describe('prompts CRUD', () => {
  const validPrompt = {
    name: 'Test prompt',
    template: 'Summarise {{input}}',
    params: validParams,
  };

  it('creates a prompt with an initial version', async () => {
    const response = await createPrompt(post('/prompts', validPrompt));
    expect(response.status).toBe(201);

    const body = await json(response);
    expect(body.data.prompt.name).toBe('Test prompt');
    expect(body.data.currentVersion.version).toBe(1);
    expect(body.data.prompt.currentVersionId).toBe(body.data.currentVersion.id);
  });

  it('rejects a prompt with no name', async () => {
    const response = await createPrompt(post('/prompts', { ...validPrompt, name: '' }));
    expect(response.status).toBe(422);

    const body = await json(response);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toHaveProperty('name');
  });

  it('rejects a body that is not valid JSON', async () => {
    const response = await createPrompt(
      new Request(`${BASE}/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ broken',
      }),
    );

    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe('bad_request');
  });

  it('enforces the template length ceiling', async () => {
    const response = await createPrompt(
      post('/prompts', { ...validPrompt, template: 'x'.repeat(200_000) }),
    );
    expect(response.status).toBe(422);
  });

  it('caps the number of tags', async () => {
    const response = await createPrompt(
      post('/prompts', {
        ...validPrompt,
        tags: Array.from({ length: 25 }, (_, i) => `t${i}`),
      }),
    );
    expect(response.status).toBe(422);
  });

  it('lists and filters prompts', async () => {
    await createPrompt(post('/prompts', { ...validPrompt, name: 'Alpha', tags: ['x'] }));
    await createPrompt(post('/prompts', { ...validPrompt, name: 'Beta', tags: ['y'] }));

    expect((await json(await listPrompts(get('/prompts')))).data.total).toBe(2);
    expect((await json(await listPrompts(get('/prompts?search=alpha')))).data.total).toBe(
      1,
    );
    expect((await json(await listPrompts(get('/prompts?tags=y')))).data.total).toBe(1);
  });

  it('fetches a prompt by id', async () => {
    const created = await json(await createPrompt(post('/prompts', validPrompt)));
    const body = await json(
      await getPrompt(
        get(`/prompts/${created.data.prompt.id}`),
        params(created.data.prompt.id),
      ),
    );

    expect(body.data.prompt.id).toBe(created.data.prompt.id);
    expect(body.data.currentVersion.template).toBe('Summarise {{input}}');
  });

  it('returns 404 for an unknown prompt', async () => {
    const response = await getPrompt(get('/prompts/nope'), params('nope'));
    expect(response.status).toBe(404);
    expect((await json(response)).error.code).toBe('not_found');
  });

  it('updates metadata', async () => {
    const created = await json(await createPrompt(post('/prompts', validPrompt)));
    const id = created.data.prompt.id;

    const response = await patchPrompt(
      new Request(`${BASE}/prompts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite: true, name: 'Renamed' }),
      }),
      params(id),
    );

    const body = await json(response);
    expect(body.data.favorite).toBe(true);
    expect(body.data.name).toBe('Renamed');
  });

  it('deletes a prompt', async () => {
    const created = await json(await createPrompt(post('/prompts', validPrompt)));
    const id = created.data.prompt.id;

    await deletePrompt(
      new Request(`${BASE}/prompts/${id}`, { method: 'DELETE' }),
      params(id),
    );
    expect((await getPrompt(get(`/prompts/${id}`), params(id))).status).toBe(404);
  });
});

describe('prompt versioning', () => {
  async function seedPrompt() {
    const created = await json(
      await createPrompt(
        post('/prompts', { name: 'Versioned', template: 'v1 body', params: validParams }),
      ),
    );
    return created.data.prompt.id as string;
  }

  it('appends versions with incrementing numbers', async () => {
    const id = await seedPrompt();

    await createVersion(
      post(`/prompts/${id}/versions`, {
        template: 'v2 body',
        params: validParams,
        changeNote: 'second',
      }),
      params(id),
    );

    const body = await json(
      await listVersions(get(`/prompts/${id}/versions`), params(id)),
    );
    expect(body.data.map((v: any) => v.version)).toEqual([2, 1]);
  });

  it('moves the current pointer to the newest version', async () => {
    const id = await seedPrompt();

    const created = await json(
      await createVersion(
        post(`/prompts/${id}/versions`, { template: 'v2', params: validParams }),
        params(id),
      ),
    );

    const prompt = await json(await getPrompt(get(`/prompts/${id}`), params(id)));
    expect(prompt.data.prompt.currentVersionId).toBe(created.data.id);
  });

  it('rolls back by appending a copy rather than deleting history', async () => {
    const id = await seedPrompt();
    const versions = await json(
      await listVersions(get(`/prompts/${id}/versions`), params(id)),
    );
    const v1 = versions.data[0];

    await createVersion(
      post(`/prompts/${id}/versions`, { template: 'v2 body', params: validParams }),
      params(id),
    );

    const restored = await json(
      await rollback(
        new Request(`${BASE}/prompts/${id}/versions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versionId: v1.id }),
        }),
        params(id),
      ),
    );

    expect(restored.data.version).toBe(3);
    expect(restored.data.template).toBe('v1 body');
    expect(restored.data.changeNote).toContain('Rolled back to v1');

    // All three versions survive.
    const after = await json(
      await listVersions(get(`/prompts/${id}/versions`), params(id)),
    );
    expect(after.data).toHaveLength(3);
  });

  it('refuses to roll back to a version of a different prompt', async () => {
    const a = await seedPrompt();
    const b = await seedPrompt();
    const bVersions = await json(
      await listVersions(get(`/prompts/${b}/versions`), params(b)),
    );

    const response = await rollback(
      new Request(`${BASE}/prompts/${a}/versions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: bVersions.data[0].id }),
      }),
      params(a),
    );

    expect(response.status).toBe(404);
  });
});

describe('POST /datasets', () => {
  it('parses a CSV upload and reports the schema', async () => {
    const response = await createDataset(
      post('/datasets', {
        name: 'Cases',
        format: 'csv',
        content: 'question,expected\nWhat is 2+2?,4\nCapital of France?,Paris',
      }),
    );

    expect(response.status).toBe(201);
    const body = await json(response);
    expect(body.data.dataset.rowCount).toBe(2);
    expect(body.data.dataset.columns).toEqual(['question', 'expected']);
  });

  it('surfaces parse warnings without failing the upload', async () => {
    const body = await json(
      await createDataset(
        post('/datasets', { name: 'Ragged', format: 'csv', content: 'a,b,c\n1,2' }),
      ),
    );

    expect(body.data.warnings.length).toBeGreaterThan(0);
  });

  it('rejects an unparseable file with a 422', async () => {
    const response = await createDataset(
      post('/datasets', { name: 'Bad', format: 'json', content: '{not json' }),
    );

    expect(response.status).toBe(422);
    expect((await json(response)).error.message).toMatch(/invalid json/i);
  });

  it('rejects an unsupported format at validation time', async () => {
    const response = await createDataset(
      post('/datasets', { name: 'X', format: 'xlsx', content: 'x' }),
    );
    expect(response.status).toBe(422);
  });
});

describe('POST /benchmarks', () => {
  it('runs, evaluates, persists, and summarises', async () => {
    const response = await runBenchmark(
      post('/benchmarks', {
        name: 'Integration run',
        template: 'Classify: {{text}}',
        modelIds: ['openai/gpt-4o-mini', 'groq/llama-3.1-8b-instant'],
        params: validParams,
        cases: [{ variables: { text: 'urgent outage' } }],
        evaluate: true,
        rubricId: 'fast-heuristic',
      }),
    );

    expect(response.status).toBe(201);
    const body = await json(response);

    expect(body.data.run.status).toBe('succeeded');
    expect(body.data.resultCount).toBe(2);
    expect(body.data.run.summary.models).toHaveLength(2);
    expect(body.data.run.summary.winnerModelId).not.toBeNull();
    expect(body.data.run.totalCostUsd).toBeGreaterThan(0);
  });

  it('runs a dataset by id, mapping columns onto template variables', async () => {
    const dataset = await json(
      await createDataset(
        post('/datasets', {
          name: 'DS',
          format: 'csv',
          content: 'text,unused\nfirst case,ignored\nsecond case,ignored',
        }),
      ),
    );

    const body = await json(
      await runBenchmark(
        post('/benchmarks', {
          template: 'Echo: {{text}}',
          modelIds: ['openai/gpt-4o-mini'],
          params: validParams,
          datasetId: dataset.data.dataset.id,
          evaluate: false,
        }),
      ),
    );

    expect(body.data.resultCount).toBe(2);
    // Only the referenced column is threaded through.
    expect(body.data.results[0].variables).toEqual({ text: 'first case' });
  });

  it('rejects supplying both inline cases and a dataset', async () => {
    const response = await runBenchmark(
      post('/benchmarks', {
        template: 'x',
        modelIds: ['openai/gpt-4o-mini'],
        params: validParams,
        cases: [{ variables: {} }],
        datasetId: 'ds_1',
      }),
    );

    expect(response.status).toBe(422);
  });

  it('rejects an unknown rubric', async () => {
    const response = await runBenchmark(
      post('/benchmarks', {
        template: 'x',
        modelIds: ['openai/gpt-4o-mini'],
        params: validParams,
        cases: [{ variables: {} }],
        rubricId: 'no-such-rubric',
      }),
    );

    expect(response.status).toBe(422);
  });

  it('rejects an empty model list', async () => {
    const response = await runBenchmark(
      post('/benchmarks', {
        template: 'x',
        modelIds: [],
        params: validParams,
        cases: [{ variables: {} }],
      }),
    );
    expect(response.status).toBe(422);
  });
});

describe('run retrieval and reports', () => {
  async function seedRun() {
    const body = await json(
      await runBenchmark(
        post('/benchmarks', {
          name: 'Report run',
          template: 'Explain {{topic}}',
          modelIds: ['openai/gpt-4o-mini'],
          params: validParams,
          cases: [{ variables: { topic: 'sharding' } }],
          evaluate: true,
          rubricId: 'fast-heuristic',
        }),
      ),
    );
    return body.data.run.id as string;
  }

  it('returns a run with its result rows', async () => {
    const runId = await seedRun();
    const body = await json(await getRun(get(`/runs/${runId}`), params(runId)));

    expect(body.data.run.id).toBe(runId);
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0].evaluation).not.toBeNull();
  });

  it('404s an unknown run', async () => {
    expect((await getRun(get('/runs/nope'), params('nope'))).status).toBe(404);
  });

  it('renders a markdown report carrying the synthetic-data warning', async () => {
    const runId = await seedRun();
    const response = await getReport(
      get(`/runs/${runId}/report?format=markdown`),
      params(runId),
    );

    expect(response.headers.get('content-type')).toContain('text/markdown');
    const text = await response.text();

    expect(text).toContain('# Model comparison');
    expect(text).toContain('Executive summary');
    expect(text).toMatch(/synthetic data/i);
  });

  it('renders a self-contained HTML report', async () => {
    const runId = await seedRun();
    const text = await (
      await getReport(get(`/runs/${runId}/report?format=html`), params(runId))
    ).text();

    expect(text.startsWith('<!doctype html>')).toBe(true);
    expect(text).toContain('<style>');
    // No external asset requests — the file must work offline.
    expect(text).not.toMatch(/<script src=|<link .*href="http/);
  });

  it('renders a structured JSON report', async () => {
    const runId = await seedRun();
    const body = await json(
      await getReport(get(`/runs/${runId}/report?format=json`), params(runId)),
    );

    expect(body.generator).toBe('promptbench-ai');
    expect(body.synthetic).toBe(true);
    expect(body.results).toHaveLength(1);
  });

  it('sets an attachment disposition when asked to download', async () => {
    const runId = await seedRun();
    const response = await getReport(
      get(`/runs/${runId}/report?format=markdown&download=1`),
      params(runId),
    );

    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename=/);
  });

  it('rejects an unsupported report format', async () => {
    const runId = await seedRun();
    const response = await getReport(
      get(`/runs/${runId}/report?format=docx`),
      params(runId),
    );
    expect(response.status).toBe(400);
  });
});

describe('POST /evaluate', () => {
  it('scores an arbitrary response against a rubric', async () => {
    const body = await json(
      await evaluateRoute(
        post('/evaluate', {
          prompt: 'Explain eventual consistency.',
          response:
            'Eventual consistency guarantees that replicas converge once writes stop, ' +
            'without promising that any individual read sees the latest write.',
          rubricId: 'fast-heuristic',
        }),
      ),
    );

    expect(body.data.overallScore).toBeGreaterThan(0);
    expect(body.data.criteria.length).toBe(2);
    expect(body.data.rubricId).toBe('fast-heuristic');
  });

  it('accepts a custom criteria selection', async () => {
    const body = await json(
      await evaluateRoute(
        post('/evaluate', {
          prompt: 'q',
          response: 'A response long enough for the heuristics to measure properly.',
          criteria: [{ id: 'readability', weight: 2 }],
        }),
      ),
    );

    expect(body.data.criteria).toHaveLength(1);
    expect(body.data.criteria[0].criterionId).toBe('readability');
  });

  it('rejects an empty response', async () => {
    const response = await evaluateRoute(
      post('/evaluate', { prompt: 'q', response: '' }),
    );
    expect(response.status).toBe(422);
  });

  it('rejects an unknown criterion', async () => {
    const response = await evaluateRoute(
      post('/evaluate', { prompt: 'q', response: 'x', criteria: [{ id: 'vibes' }] }),
    );
    expect(response.status).toBe(422);
  });
});
