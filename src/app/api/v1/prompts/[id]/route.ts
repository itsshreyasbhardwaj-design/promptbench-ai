import { route } from '@/lib/api/handler';
import { updatePromptSchema } from '@/lib/api/schemas';
import { deletePrompt, getPrompt, updatePrompt } from '@/lib/services/prompts';
import { badRequest } from '@/lib/core/errors';

function promptId(params: Record<string, string>): string {
  const id = params.id;
  if (!id) throw badRequest('A prompt id is required.');
  return id;
}

/** GET /api/v1/prompts/:id */
export const GET = route({
  permission: 'prompt:read',
  handler: async ({ session, params }) => getPrompt(session, promptId(params)),
});

/** PATCH /api/v1/prompts/:id — update metadata (not content; that is a version). */
export const PATCH = route({
  permission: 'prompt:write',
  bodySchema: updatePromptSchema,
  handler: async ({ session, params, body }) =>
    updatePrompt(session, promptId(params), body),
});

/** DELETE /api/v1/prompts/:id */
export const DELETE = route({
  permission: 'prompt:delete',
  handler: async ({ session, params }) => {
    await deletePrompt(session, promptId(params));
    return { deleted: true };
  },
});
