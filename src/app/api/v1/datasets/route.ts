import { route, paginationSchema } from '@/lib/api/handler';
import { createDatasetSchema } from '@/lib/api/schemas';
import { getRepositories } from '@/lib/db';
import { newId } from '@/lib/core/id';
import { parseDataset } from '@/lib/datasets/parse';
import { serverEnv } from '@/lib/env';

export const runtime = 'nodejs';

/** GET /api/v1/datasets */
export const GET = route({
  permission: 'dataset:read',
  querySchema: paginationSchema,
  handler: async ({ session, query }) =>
    getRepositories().datasets.list(session.workspaceId, {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    }),
});

/**
 * POST /api/v1/datasets — upload and parse a dataset.
 *
 * Parsing happens here rather than at run time so malformed data is rejected at
 * the point of upload, when the user still has the file in front of them,
 * rather than halfway through a paid benchmark.
 */
export const POST = route({
  permission: 'dataset:write',
  bodySchema: createDatasetSchema,
  status: 201,
  handler: async ({ session, body }) => {
    const parsed = parseDataset(body.content, body.format, {
      maxRows: serverEnv().MAX_DATASET_ROWS,
    });

    const dataset = await getRepositories().datasets.create({
      id: newId('ds'),
      workspaceId: session.workspaceId,
      name: body.name,
      description: body.description,
      format: body.format,
      columns: parsed.columns,
      rowCount: parsed.rows.length,
      rows: parsed.rows,
      createdBy: session.userId,
    });

    return { dataset, warnings: parsed.warnings };
  },
});
