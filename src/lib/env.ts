import { z } from 'zod';

/**
 * Runtime environment contract.
 *
 * PromptBench is designed to run in three distinct modes, and the schema below
 * is what decides which one you get. Nothing here throws at import time in a
 * way that would break `next build`; instead invalid configuration surfaces as
 * a single, readable error listing every offending variable.
 *
 * - `local`   no external credentials at all. Model responses come from the
 *             deterministic local driver, persistence is in-memory. This is the
 *             default so `pnpm dev` works on a fresh clone, and it is what CI
 *             and the E2E suite run against.
 * - `hybrid`  real models via OpenRouter, but still in-memory persistence.
 * - `full`    OpenRouter + Postgres + Clerk. The production configuration.
 */

const nonEmpty = z.string().trim().min(1);

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Explicit driver override. When unset it is inferred from the other vars. */
  PROMPTBENCH_DRIVER: z.enum(['local', 'openrouter']).optional(),

  /** OpenRouter credentials. Absent => local driver. */
  OPENROUTER_API_KEY: nonEmpty.optional(),
  OPENROUTER_BASE_URL: z.url().default('https://openrouter.ai/api/v1'),

  /** Postgres (Supabase) connection string. Absent => in-memory repositories. */
  DATABASE_URL: z
    .string()
    .trim()
    .refine((v) => v === '' || /^postgres(ql)?:\/\//.test(v), {
      message: 'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    })
    .optional(),

  /** Clerk. Absent => single-tenant local identity. */
  CLERK_SECRET_KEY: nonEmpty.optional(),

  /** Sliding-window rate limit applied to the public REST API, per identity. */
  RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().max(100_000).default(60),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().max(3600).default(60),

  /** Hard ceiling on how many models a single comparison may fan out to. */
  MAX_MODELS_PER_RUN: z.coerce.number().int().positive().max(32).default(8),
  /** Hard ceiling on dataset rows accepted per batch benchmark. */
  MAX_DATASET_ROWS: z.coerce.number().int().positive().max(100_000).default(1000),
  /** Per-request timeout when talking to a model provider. */
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: nonEmpty.optional(),
  NEXT_PUBLIC_DEMO_MODE: booleanish.default(false),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type ClientEnv = z.infer<typeof clientSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

function parseOrThrow<T extends z.ZodType>(schema: T, source: unknown, label: string) {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid ${label} environment configuration:\n${formatIssues(result.error)}\n\n` +
        `See .env.example for the full contract. PromptBench runs with zero ` +
        `credentials by default — you only need to set variables you actually use.`,
    );
  }
  return result.data as z.infer<T>;
}

// `process.env` keys must be referenced statically for Next.js inlining to work
// on the client, hence the explicit object rather than passing `process.env`.
const rawClient = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
};

function stripUndefined(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
}

export const clientEnv: ClientEnv = parseOrThrow(
  clientSchema,
  stripUndefined(rawClient),
  'client',
);

let cachedServerEnv: ServerEnv | null = null;

/**
 * Server-only environment. Lazily parsed so that importing a shared module from
 * a client component never trips server validation.
 */
export function serverEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  cachedServerEnv = parseOrThrow(serverSchema, stripUndefined(process.env), 'server');
  return cachedServerEnv;
}

/** Test seam: forces the next `serverEnv()` call to re-read `process.env`. */
export function resetServerEnvCache(): void {
  cachedServerEnv = null;
}

export type RuntimeMode = 'local' | 'hybrid' | 'full';

export interface RuntimeCapabilities {
  mode: RuntimeMode;
  /** True when model calls hit OpenRouter rather than the local driver. */
  liveModels: boolean;
  /** True when data is persisted to Postgres rather than process memory. */
  persistentStorage: boolean;
  /** True when Clerk is wired up and multi-tenant auth is enforced. */
  managedAuth: boolean;
}

export function runtimeCapabilities(env: ServerEnv = serverEnv()): RuntimeCapabilities {
  const liveModels =
    env.PROMPTBENCH_DRIVER === 'openrouter' ||
    (env.PROMPTBENCH_DRIVER !== 'local' && Boolean(env.OPENROUTER_API_KEY));
  const persistentStorage = Boolean(env.DATABASE_URL);
  const managedAuth = Boolean(env.CLERK_SECRET_KEY);

  const mode: RuntimeMode =
    liveModels && persistentStorage && managedAuth
      ? 'full'
      : liveModels
        ? 'hybrid'
        : 'local';

  return { mode, liveModels, persistentStorage, managedAuth };
}
