import { route } from '@/lib/api/handler';
import { runBenchmarkSchema } from '@/lib/api/schemas';
import { executeRun } from '@/lib/services/benchmarks';
import { getRepositories } from '@/lib/db';
import { paginationSchema } from '@/lib/api/handler';
import { serverEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** GET /api/v1/benchmarks — list saved benchmark configurations. */
export const GET = route({
  permission: 'benchmark:read',
  querySchema: paginationSchema,
  handler: async ({ session, query }) =>
    getRepositories().benchmarks.list(session.workspaceId, {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    }),
});

/**
 * POST /api/v1/benchmarks — create and execute a benchmark run.
 *
 * Synchronous: the response arrives when the run finishes. That is the right
 * shape for the interactive case and for scripted use, both of which want the
 * result rather than a job id to poll. Long dataset sweeps should be chunked by
 * the caller, or run behind a queue — see `docs/architecture.md`.
 *
 * Rate limited more tightly than reads because each call fans out to
 * `models × cases` provider requests.
 */
export const POST = route({
  permission: 'benchmark:run',
  bodySchema: runBenchmarkSchema,
  status: 201,
  rateLimit: { limit: Math.max(3, Math.floor(60 / 6)), windowSeconds: 60 },
  handler: async ({ session, body }) => {
    const env = serverEnv();
    const { run, results } = await executeRun(session, body);

    return {
      run,
      // Full result payloads can be very large on a dataset sweep; the caller
      // fetches them from /runs/:id when it actually needs them.
      resultCount: results.length,
      results: results.length <= env.MAX_MODELS_PER_RUN * 5 ? results : undefined,
    };
  },
});
