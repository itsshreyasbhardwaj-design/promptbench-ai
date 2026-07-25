import { route } from '@/lib/api/handler';
import { deleteRun, getRun } from '@/lib/services/benchmarks';
import { badRequest } from '@/lib/core/errors';

function runId(params: Record<string, string>): string {
  const id = params.id;
  if (!id) throw badRequest('A run id is required.');
  return id;
}

/** GET /api/v1/runs/:id — a run with its full result rows. */
export const GET = route({
  permission: 'benchmark:read',
  handler: async ({ session, params }) => getRun(session, runId(params)),
});

/** DELETE /api/v1/runs/:id */
export const DELETE = route({
  permission: 'benchmark:delete',
  handler: async ({ session, params }) => {
    await deleteRun(session, runId(params));
    return { deleted: true };
  },
});
