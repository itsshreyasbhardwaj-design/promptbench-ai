import { serverEnv } from '@/lib/env';
import { MemoryRepositories } from '@/lib/db/memory';
import { getDatabase, PostgresRepositories } from '@/lib/db/postgres';
import type { Repositories } from '@/lib/db/repositories';

/**
 * Repository resolution.
 *
 * Picks the Postgres driver when `DATABASE_URL` is set and the in-memory driver
 * otherwise. The instance is memoised on `globalThis` rather than a module
 * variable because Next's dev server re-evaluates modules on every hot reload;
 * a plain module-level cache would silently discard all in-memory data on each
 * file save, which makes local development miserable to no purpose.
 */

const CACHE_KEY = Symbol.for('promptbench.repositories');

interface GlobalCache {
  [CACHE_KEY]?: Repositories;
}

const globalCache = globalThis as unknown as GlobalCache;

export function getRepositories(): Repositories {
  const cached = globalCache[CACHE_KEY];
  if (cached) return cached;

  const env = serverEnv();
  const repositories: Repositories = env.DATABASE_URL
    ? new PostgresRepositories(getDatabase(env.DATABASE_URL))
    : new MemoryRepositories();

  globalCache[CACHE_KEY] = repositories;
  return repositories;
}

/** Replaces the active repositories. Tests only. */
export function setRepositories(repositories: Repositories): void {
  globalCache[CACHE_KEY] = repositories;
}

/** Drops the cached instance so the next call re-resolves the driver. */
export function resetRepositories(): void {
  delete globalCache[CACHE_KEY];
}

export type { Repositories };
