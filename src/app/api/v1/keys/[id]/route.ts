import { route } from '@/lib/api/handler';
import { getRepositories } from '@/lib/db';
import { badRequest } from '@/lib/core/errors';

export const runtime = 'nodejs';

/**
 * DELETE /api/v1/keys/:id — revoke a key.
 *
 * Revocation is a soft delete: the row is retained with `revokedAt` set so the
 * audit trail of which key did what survives. Session resolution rejects any
 * key with a non-null `revokedAt`.
 */
export const DELETE = route({
  permission: 'apikey:write',
  handler: async ({ session, params }) => {
    const id = params.id;
    if (!id) throw badRequest('An API key id is required.');
    await getRepositories().apiKeys.revoke(session.workspaceId, id);
    return { revoked: true };
  },
});
