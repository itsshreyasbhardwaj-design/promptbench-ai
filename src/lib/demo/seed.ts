import { getRepositories } from '@/lib/db';
import { newId } from '@/lib/core/id';
import type { Session } from '@/lib/auth/session';
import { DEFAULT_COMPLETION_PARAMS } from '@/lib/core/types';
import { runBenchmark } from '@/lib/benchmark/runner';
import { getRubric } from '@/lib/evaluation/rubrics';

/**
 * Demo seeding.
 *
 * An empty dashboard teaches a new user nothing about what the product does.
 * This populates a fresh workspace with realistic prompts and one completed,
 * evaluated run so that the charts, leaderboard and report all have real shape
 * on the very first visit.
 *
 * Guarded three ways: it only runs in demo mode, only when the workspace has no
 * prompts of its own, and behind a per-workspace lock so concurrent requests
 * during initial render cannot seed twice.
 */

const SEED_PROMPTS = [
  {
    name: 'Bug triage classifier',
    description:
      'Classifies an incoming issue by severity and component, and proposes an owner.',
    collection: 'Engineering',
    tags: ['classification', 'production', 'json-output'],
    template: `You are triaging an incoming bug report for a web application.

Report:
"""
{{report}}
"""

Classify it and respond with JSON only:
{"severity": "critical|high|medium|low", "component": "...", "rationale": "one sentence"}

Severity guidance: critical means data loss or a full outage; high means a core flow is broken for many users; medium means a workaround exists; low is cosmetic.`,
    systemPrompt:
      'You are a precise triage assistant. Respond with valid JSON and nothing else.',
  },
  {
    name: 'SQL from natural language',
    description:
      'Converts a plain-English question into a Postgres query against a fixed schema.',
    collection: 'Engineering',
    tags: ['code', 'sql', 'postgres'],
    template: `Given this Postgres schema:

  users(id, email, created_at, plan)
  events(id, user_id, name, properties jsonb, occurred_at)

Write a single SQL query that answers:

  {{question}}

Return only the query. Use explicit joins. Do not invent columns.`,
    systemPrompt: 'You are an expert Postgres engineer. Prefer clarity over cleverness.',
  },
  {
    name: 'Release notes from commits',
    description:
      'Turns a raw commit log into user-facing release notes grouped by theme.',
    collection: 'Product',
    tags: ['writing', 'summarisation'],
    template: `Turn the following commit log into release notes for end users.

{{commits}}

Rules:
- Group into "New", "Improved", and "Fixed". Omit any empty group.
- One line per item, written for a non-engineer.
- No commit hashes, no internal module names.
- Lead with the change that matters most to users.`,
    systemPrompt: '',
  },
  {
    name: 'Support reply drafter',
    description: 'Drafts an empathetic first response to a customer complaint.',
    collection: 'Support',
    tags: ['writing', 'tone', 'customer-facing'],
    template: `A customer wrote in:

"""
{{message}}
"""

Draft a reply that acknowledges the specific problem, states what happens next, and gives a realistic timeframe. Do not apologise more than once. Do not promise a refund. Sign off as "the {{team}} team".`,
    systemPrompt: 'You write clear, warm, non-corporate support replies.',
  },
] as const;

/** Cases used for the seeded benchmark run. */
const SEED_CASES = [
  {
    variables: {
      report:
        'Checkout page returns a 500 for users on the Pro plan when the cart contains more than 12 items. Started after this morning’s deploy.',
    },
  },
  {
    variables: {
      report:
        'The avatar in the top-right corner is slightly misaligned on Safari, about 2px too low.',
    },
  },
  {
    variables: {
      report:
        'Exported CSVs are missing the final row for every export over 10,000 records. Confirmed on three accounts.',
    },
  },
] as const;

const SEED_MODELS = [
  'openai/gpt-4o-mini',
  'anthropic/claude-3-5-haiku',
  'google/gemini-2.5-flash',
  'groq/llama-3.1-8b-instant',
];

/** Prevents duplicate seeding when several requests render concurrently. */
const inFlight = new Map<string, Promise<void>>();

export async function seedDemoWorkspace(session: Session): Promise<void> {
  const existing = inFlight.get(session.workspaceId);
  if (existing) return existing;

  const task = seed(session).finally(() => inFlight.delete(session.workspaceId));
  inFlight.set(session.workspaceId, task);
  return task;
}

async function seed(session: Session): Promise<void> {
  const repos = getRepositories();

  const prompts = await repos.prompts.list(session.workspaceId, { limit: 1 });
  if (prompts.total > 0) return;

  for (const [index, seedPrompt] of SEED_PROMPTS.entries()) {
    const promptId = newId('prompt');

    await repos.prompts.create({
      id: promptId,
      workspaceId: session.workspaceId,
      name: seedPrompt.name,
      description: seedPrompt.description,
      collection: seedPrompt.collection,
      tags: [...seedPrompt.tags],
      favorite: index === 0,
      currentVersionId: null,
      createdBy: session.userId,
    });

    const version = await repos.promptVersions.create({
      id: newId('ver'),
      promptId,
      workspaceId: session.workspaceId,
      version: 1,
      template: seedPrompt.template,
      systemPrompt: seedPrompt.systemPrompt,
      params: DEFAULT_COMPLETION_PARAMS,
      createdBy: session.userId,
      changeNote: 'Initial version',
    });

    await repos.prompts.update(session.workspaceId, promptId, {
      currentVersionId: version.id,
    });

    // Give the first prompt a version history so the diff and rollback views
    // have something meaningful to show.
    if (index === 0) {
      const v2 = await repos.promptVersions.create({
        id: newId('ver'),
        promptId,
        workspaceId: session.workspaceId,
        version: 2,
        template: seedPrompt.template.replace(
          'Severity guidance:',
          'If the report is ambiguous, choose the lower severity and say why.\n\nSeverity guidance:',
        ),
        systemPrompt: seedPrompt.systemPrompt,
        params: { ...DEFAULT_COMPLETION_PARAMS, temperature: 0.2 },
        createdBy: session.userId,
        changeNote: 'Bias toward lower severity when ambiguous; drop temperature to 0.2',
      });
      await repos.prompts.update(session.workspaceId, promptId, {
        currentVersionId: v2.id,
      });
    }
  }

  await seedRun(session);
}

async function seedRun(session: Session): Promise<void> {
  const repos = getRepositories();
  const template = SEED_PROMPTS[0].template;

  const benchmark = await repos.benchmarks.create({
    id: newId('bench'),
    workspaceId: session.workspaceId,
    name: 'Bug triage — model comparison',
    description: 'Example run comparing four low-cost models on issue triage.',
    promptId: null,
    promptVersionId: null,
    datasetId: null,
    modelIds: SEED_MODELS,
    rubricId: 'general-quality',
    judgeModelId: 'openai/gpt-4o-mini',
    params: DEFAULT_COMPLETION_PARAMS,
    createdBy: session.userId,
  });

  const runId = newId('run');
  await repos.runs.create({
    id: runId,
    benchmarkId: benchmark.id,
    workspaceId: session.workspaceId,
    status: 'running',
    promptTemplate: template,
    systemPrompt: SEED_PROMPTS[0].systemPrompt,
    modelIds: SEED_MODELS,
    summary: null,
    totalCostUsd: 0,
    totalTokens: 0,
    avgLatencyMs: 0,
    caseCount: SEED_CASES.length,
    errorMessage: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    createdBy: session.userId,
  });

  const output = await runBenchmark({
    promptTemplate: template,
    systemPrompt: SEED_PROMPTS[0].systemPrompt,
    modelIds: SEED_MODELS,
    params: DEFAULT_COMPLETION_PARAMS,
    cases: SEED_CASES.map((c) => ({ variables: { ...c.variables } })),
    ...(getRubric('general-quality') ? { rubric: getRubric('general-quality')! } : {}),
  });

  await repos.runResults.createMany(
    output.rows.map((row) => ({
      id: row.id,
      runId,
      workspaceId: session.workspaceId,
      modelId: row.modelId,
      caseIndex: row.caseIndex,
      variables: row.variables,
      completion: row.completion,
      evaluation: row.evaluation,
      score: row.evaluation?.overallScore ?? null,
      latencyMs: row.completion.latencyMs,
      costUsd: row.completion.cost.totalCostUsd,
      totalTokens: row.completion.usage.totalTokens,
    })),
  );

  await repos.runs.update(runId, {
    status: 'succeeded',
    summary: output.summary,
    totalCostUsd: output.summary.totalCostUsd,
    totalTokens: output.summary.totalTokens,
    avgLatencyMs: output.summary.avgLatencyMs,
    finishedAt: output.finishedAt,
  });
}
