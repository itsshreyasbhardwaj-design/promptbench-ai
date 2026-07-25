import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError, errorMessage, isAppError } from '@/lib/core/errors';
import { requireSession, type Session } from '@/lib/auth/session';
import {
  enforceRateLimit,
  rateLimitHeaders,
  rateLimitIdentity,
  type RateLimitOptions,
} from '@/lib/api/rate-limit';
import { requirePermission, type Permission } from '@/lib/auth/permissions';

/**
 * Route handler wrapper.
 *
 * Centralises the five things every endpoint needs — auth, permissions, rate
 * limiting, body/query validation and error shaping — so an individual route is
 * only its business logic. Getting any one of these wrong in one route is the
 * usual way an API grows a security hole; here there is one implementation.
 */

export interface ApiSuccess<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface HandlerContext<TBody, TQuery> {
  request: Request;
  session: Session;
  body: TBody;
  query: TQuery;
  params: Record<string, string>;
}

export interface RouteConfig<TBody, TQuery, TResult> {
  /** Requires an authenticated session. Defaults to true. */
  auth?: boolean;
  /** Permission the caller's role must satisfy. */
  permission?: Permission;
  bodySchema?: z.ZodType<TBody>;
  querySchema?: z.ZodType<TQuery>;
  rateLimit?: RateLimitOptions | false;
  handler: (context: HandlerContext<TBody, TQuery>) => Promise<TResult>;
  /** HTTP status on success. Defaults to 200. */
  status?: number;
}

type RouteParams = { params?: Promise<Record<string, string>> };

/**
 * Builds a Next.js route handler from a declarative config.
 *
 * The returned function matches the App Router signature, including the
 * `params` promise Next 15+ passes for dynamic segments.
 */
export function route<TBody = undefined, TQuery = undefined, TResult = unknown>(
  config: RouteConfig<TBody, TQuery, TResult>,
) {
  return async function handler(
    request: Request,
    context?: RouteParams,
  ): Promise<NextResponse> {
    let headers: Record<string, string> = {};

    try {
      const session =
        config.auth === false ? null : await requireSession(request.headers);

      if (config.rateLimit !== false) {
        const result = await enforceRateLimit(
          rateLimitIdentity(request, session),
          config.rateLimit ?? undefined,
        );
        headers = rateLimitHeaders(result);
      }

      if (config.permission) {
        if (!session) throw new AppError('unauthorized', 'Authentication is required.');
        requirePermission(session.role, config.permission);
      }

      const body = await parseBody(request, config.bodySchema);
      const query = parseQuery(request, config.querySchema);
      const params = (await context?.params) ?? {};

      const data = await config.handler({
        request,
        session: session as Session,
        body,
        query,
        params,
      });

      return NextResponse.json<ApiSuccess<TResult>>(
        { data: data as TResult },
        { status: config.status ?? 200, headers },
      );
    } catch (error) {
      return errorResponse(error, headers);
    }
  };
}

async function parseBody<T>(request: Request, schema?: z.ZodType<T>): Promise<T> {
  if (!schema) return undefined as T;

  let raw: unknown;
  try {
    const text = await request.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new AppError('bad_request', 'Request body must be valid JSON.');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError('validation_failed', 'Request body failed validation.', {
      details: flattenIssues(result.error),
    });
  }
  return result.data;
}

function parseQuery<T>(request: Request, schema?: z.ZodType<T>): T {
  if (!schema) return undefined as T;

  const url = new URL(request.url);
  const raw: Record<string, string | string[]> = {};

  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : values[0]!;
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError('validation_failed', 'Query parameters failed validation.', {
      details: flattenIssues(result.error),
    });
  }
  return result.data;
}

/** Turns Zod issues into a `field -> messages` map the UI can render inline. */
export function flattenIssues(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

/**
 * Maps any thrown value to a JSON error response.
 *
 * Unrecognised errors deliberately return a generic message: an unexpected
 * exception can carry connection strings or internal paths, and those must not
 * reach a client. The detail is logged server-side instead.
 */
export function errorResponse(
  error: unknown,
  headers: Record<string, string> = {},
): NextResponse<ApiFailure> {
  if (isAppError(error)) {
    return NextResponse.json<ApiFailure>(
      { error: error.toJSON() },
      { status: error.status, headers },
    );
  }

  console.error('[api] unhandled error:', error);

  return NextResponse.json<ApiFailure>(
    {
      error: {
        code: 'internal_error',
        message: 'An unexpected error occurred. Please try again.',
      },
    },
    { status: 500, headers },
  );
}

/** Shared pagination query schema. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** Coerces a repeated or comma-separated query param into an array. */
export const csvArray = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(','))
      .map((v) => v.trim())
      .filter(Boolean),
  );

export { errorMessage };
