import { route } from '@/lib/api/handler';
import { createApiKeySchema } from '@/lib/api/schemas';
import { getRepositories } from '@/lib/db';
import { newId } from '@/lib/core/id';
import { generateApiKey } from '@/lib/auth/api-keys';

export const runtime = 'nodejs';

/**
 * GET /api/v1/keys — list keys.
 *
 * `keyHash` is stripped from the response. It is not itself a credential, but
 * there is no reason for it to leave the server and every reason not to widen
 * the blast radius of a logging mistake.
 */
export const GET = route({
  permission: 'apikey:read',
  handler: async ({ session }) => {
    const keys = await getRepositories().apiKeys.list(session.workspaceId);
    return keys.map(({ keyHash: _hash, ...rest }) => rest);
  },
});

/**
 * POST /api/v1/keys — mint a key.
 *
 * The plaintext is returned exactly once, here. It is never stored and cannot
 * be recovered; a lost key must be revoked and replaced.
 */
export const POST = route({
  permission: 'apikey:write',
  bodySchema: createApiKeySchema,
  status: 201,
  handler: async ({ session, body }) => {
    const generated = generateApiKey();

    const record = await getRepositories().apiKeys.create({
      id: newId('key'),
      workspaceId: session.workspaceId,
      name: body.name,
      keyHash: generated.hash,
      keyPrefix: generated.displayPrefix,
      lastUsedAt: null,
      revokedAt: null,
      createdBy: session.userId,
    });

    const { keyHash: _hash, ...safe } = record;
    return {
      key: safe,
      plaintext: generated.plaintext,
      warning: 'Copy this key now. It will not be shown again.',
    };
  },
});
