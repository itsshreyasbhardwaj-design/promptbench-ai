import { route } from '@/lib/api/handler';
import { getRepositories } from '@/lib/db';
import { badRequest, notFound } from '@/lib/core/errors';

function datasetId(params: Record<string, string>): string {
  const id = params.id;
  if (!id) throw badRequest('A dataset id is required.');
  return id;
}

/** GET /api/v1/datasets/:id — dataset with its parsed rows. */
export const GET = route({
  permission: 'dataset:read',
  handler: async ({ session, params }) => {
    const id = datasetId(params);
    const dataset = await getRepositories().datasets.findById(session.workspaceId, id);
    if (!dataset) throw notFound('Dataset', id);
    return dataset;
  },
});

/** DELETE /api/v1/datasets/:id */
export const DELETE = route({
  permission: 'dataset:delete',
  handler: async ({ session, params }) => {
    const id = datasetId(params);
    const repos = getRepositories();
    const dataset = await repos.datasets.findById(session.workspaceId, id);
    if (!dataset) throw notFound('Dataset', id);
    await repos.datasets.delete(session.workspaceId, id);
    return { deleted: true };
  },
});
