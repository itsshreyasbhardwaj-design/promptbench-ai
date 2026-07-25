import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { createCommentSchema } from '@/lib/api/schemas';
import { getRepositories } from '@/lib/db';
import { newId } from '@/lib/core/id';

const listQuerySchema = z.object({
  targetType: z.enum(['prompt', 'benchmark', 'run']),
  targetId: z.string().min(1).max(60),
});

/** GET /api/v1/comments?targetType=run&targetId=… — thread for one object. */
export const GET = route({
  permission: 'comment:read',
  querySchema: listQuerySchema,
  handler: async ({ session, query }) =>
    getRepositories().comments.listForTarget(
      session.workspaceId,
      query.targetType,
      query.targetId,
    ),
});

/** POST /api/v1/comments */
export const POST = route({
  permission: 'comment:write',
  bodySchema: createCommentSchema,
  status: 201,
  handler: async ({ session, body }) =>
    getRepositories().comments.create({
      id: newId('cmt'),
      workspaceId: session.workspaceId,
      targetType: body.targetType,
      targetId: body.targetId,
      body: body.body,
      authorId: session.userId,
      authorName: session.displayName,
    }),
});
