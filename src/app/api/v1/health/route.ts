import { NextResponse } from 'next/server';
import { runtimeCapabilities, serverEnv } from '@/lib/env';
import { CATALOG_VERSION, MODEL_CATALOG } from '@/lib/models/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/health — liveness and configuration probe.
 *
 * Unauthenticated so load balancers and uptime monitors can reach it. It
 * reports *which* capabilities are enabled but never any credential, value or
 * connection string — only booleans.
 */
export function GET(): NextResponse {
  const capabilities = runtimeCapabilities(serverEnv());

  return NextResponse.json(
    {
      status: 'ok',
      version: process.env.npm_package_version ?? '0.1.0',
      mode: capabilities.mode,
      capabilities: {
        liveModels: capabilities.liveModels,
        persistentStorage: capabilities.persistentStorage,
        managedAuth: capabilities.managedAuth,
      },
      catalog: {
        version: CATALOG_VERSION,
        modelCount: MODEL_CATALOG.length,
      },
      timestamp: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
