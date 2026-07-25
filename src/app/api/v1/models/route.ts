import { route } from '@/lib/api/handler';
import { listModelsQuerySchema } from '@/lib/api/schemas';
import {
  CATALOG_VERSION,
  listModels,
  listProviders,
  PROVIDER_LABELS,
} from '@/lib/models/catalog';
import { usingLiveModels } from '@/lib/providers/registry';
import type { ProviderId } from '@/lib/core/types';

/**
 * GET /api/v1/models — the model catalog.
 *
 * Public (no auth) because it is static reference data with no tenant content,
 * and clients benefit from being able to fetch it before signing in.
 */
export const GET = route({
  auth: false,
  querySchema: listModelsQuerySchema,
  handler: async ({ query }) => {
    const models = listModels({
      ...(query.provider ? { provider: query.provider as ProviderId } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.judgeCapable !== undefined ? { judgeCapable: query.judgeCapable } : {}),
    });

    return {
      catalogVersion: CATALOG_VERSION,
      liveModels: usingLiveModels(),
      providers: listProviders().map((id) => ({ id, label: PROVIDER_LABELS[id] })),
      models,
    };
  },
});
