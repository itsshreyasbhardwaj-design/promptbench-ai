import { route } from '@/lib/api/handler';
import { createPromptSchema, listPromptsQuerySchema } from '@/lib/api/schemas';
import { createPrompt, listPrompts } from '@/lib/services/prompts';

/** GET /api/v1/prompts — list prompts with search, tag and collection filters. */
export const GET = route({
  permission: 'prompt:read',
  querySchema: listPromptsQuerySchema,
  handler: async ({ session, query }) =>
    listPrompts(session, {
      ...(query.search ? { search: query.search } : {}),
      ...(query.collection ? { collection: query.collection } : {}),
      ...(query.tags ? { tags: query.tags } : {}),
      ...(query.favorite !== undefined ? { favorite: query.favorite } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    }),
});

/** POST /api/v1/prompts — create a prompt and its initial version. */
export const POST = route({
  permission: 'prompt:write',
  bodySchema: createPromptSchema,
  status: 201,
  handler: async ({ session, body }) => createPrompt(session, body),
});
