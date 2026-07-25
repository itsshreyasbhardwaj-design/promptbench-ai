import { route } from '@/lib/api/handler';
import { listRunsQuerySchema } from '@/lib/api/schemas';
import { listRuns } from '@/lib/services/benchmarks';

/** GET /api/v1/runs — run history for the workspace, newest first. */
export const GET = route({
  permission: 'benchmark:read',
  querySchema: listRunsQuerySchema,
  handler: async ({ session, query }) =>
    listRuns(session, {
      ...(query.benchmarkId ? { benchmarkId: query.benchmarkId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    }),
});
