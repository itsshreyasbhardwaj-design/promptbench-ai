import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { createVersionSchema } from '@/lib/api/schemas';
import { createVersion, listVersions, rollbackToVersion } from '@/lib/services/prompts';
import { badRequest } from '@/lib/core/errors';

function promptId(params: Record<string, string>): string {
  const id = params.id;
  if (!id) throw badRequest('A prompt id is required.');
  return id;
}

/** GET /api/v1/prompts/:id/versions — full version history, newest first. */
export const GET = route({
  permission: 'prompt:read',
  handler: async ({ session, params }) => listVersions(session, promptId(params)),
});

/** POST /api/v1/prompts/:id/versions — append a new version. */
export const POST = route({
  permission: 'prompt:write',
  bodySchema: createVersionSchema,
  status: 201,
  handler: async ({ session, params, body }) =>
    createVersion(session, promptId(params), body),
});

const rollbackSchema = z.object({
  versionId: z.string().min(1).max(60),
});

/**
 * PUT /api/v1/prompts/:id/versions — roll back to a previous version.
 *
 * Appends a copy rather than deleting history, so the rollback is itself
 * versioned and reversible.
 */
export const PUT = route({
  permission: 'prompt:write',
  bodySchema: rollbackSchema,
  handler: async ({ session, params, body }) =>
    rollbackToVersion(session, promptId(params), body.versionId),
});
