import { afterEach, describe, expect, it } from 'vitest';
import { resetServerEnvCache, runtimeCapabilities, serverEnv } from '@/lib/env';

/**
 * Environment contract.
 *
 * `runtimeCapabilities` decides which drivers the whole application uses, so
 * every permutation of the three credentials is pinned here. Getting this wrong
 * means either erroring on a fresh clone or silently spending money.
 */

const KEYS = [
  'OPENROUTER_API_KEY',
  'DATABASE_URL',
  'CLERK_SECRET_KEY',
  'PROMPTBENCH_DRIVER',
] as const;

const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetServerEnvCache();
  return serverEnv();
}

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetServerEnvCache();
});

describe('runtimeCapabilities', () => {
  it('defaults to local mode with no credentials at all', () => {
    const capabilities = runtimeCapabilities(setEnv({}));

    expect(capabilities.mode).toBe('local');
    expect(capabilities.liveModels).toBe(false);
    expect(capabilities.persistentStorage).toBe(false);
    expect(capabilities.managedAuth).toBe(false);
  });

  it('enters hybrid mode with an OpenRouter key alone', () => {
    const capabilities = runtimeCapabilities(
      setEnv({ OPENROUTER_API_KEY: 'sk-or-v1-test' }),
    );

    expect(capabilities.mode).toBe('hybrid');
    expect(capabilities.liveModels).toBe(true);
    expect(capabilities.persistentStorage).toBe(false);
  });

  it('enters full mode only when all three are configured', () => {
    const capabilities = runtimeCapabilities(
      setEnv({
        OPENROUTER_API_KEY: 'sk-or-v1-test',
        DATABASE_URL: 'postgresql://localhost:5432/db',
        CLERK_SECRET_KEY: 'sk_test_x',
      }),
    );

    expect(capabilities.mode).toBe('full');
    expect(capabilities.persistentStorage).toBe(true);
    expect(capabilities.managedAuth).toBe(true);
  });

  it('stays out of full mode when models are live but auth is not configured', () => {
    const capabilities = runtimeCapabilities(
      setEnv({
        OPENROUTER_API_KEY: 'sk-or-v1-test',
        DATABASE_URL: 'postgresql://localhost:5432/db',
      }),
    );
    expect(capabilities.mode).toBe('hybrid');
  });

  it('reports storage and auth independently of model mode', () => {
    // Postgres without an OpenRouter key is a legitimate configuration.
    const capabilities = runtimeCapabilities(
      setEnv({ DATABASE_URL: 'postgresql://localhost:5432/db' }),
    );

    expect(capabilities.mode).toBe('local');
    expect(capabilities.persistentStorage).toBe(true);
    expect(capabilities.liveModels).toBe(false);
  });

  it('lets an explicit local driver override a present API key', () => {
    // The escape hatch that keeps CI and offline demos free even on a machine
    // that has credentials in its environment.
    const capabilities = runtimeCapabilities(
      setEnv({ OPENROUTER_API_KEY: 'sk-or-v1-test', PROMPTBENCH_DRIVER: 'local' }),
    );

    expect(capabilities.liveModels).toBe(false);
    expect(capabilities.mode).toBe('local');
  });

  it('lets an explicit openrouter driver force live models', () => {
    const capabilities = runtimeCapabilities(
      setEnv({ PROMPTBENCH_DRIVER: 'openrouter' }),
    );
    expect(capabilities.liveModels).toBe(true);
  });
});

describe('serverEnv', () => {
  it('applies documented defaults for unset limits', () => {
    const env = setEnv({});

    expect(env.RATE_LIMIT_REQUESTS).toBe(60);
    expect(env.RATE_LIMIT_WINDOW_SECONDS).toBe(60);
    expect(env.MAX_MODELS_PER_RUN).toBe(8);
    expect(env.MAX_DATASET_ROWS).toBe(1000);
    expect(env.OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
  });

  it('rejects a DATABASE_URL that is not a Postgres connection string', () => {
    process.env.DATABASE_URL = 'mysql://localhost:3306/db';
    resetServerEnvCache();

    expect(() => serverEnv()).toThrow(/postgres/i);
  });

  it('rejects an invalid driver value', () => {
    process.env.PROMPTBENCH_DRIVER = 'anthropic-direct';
    resetServerEnvCache();

    expect(() => serverEnv()).toThrow(/PROMPTBENCH_DRIVER/);
  });

  it('memoises so repeated calls do not re-parse', () => {
    expect(setEnv({})).toBe(serverEnv());
  });
});
