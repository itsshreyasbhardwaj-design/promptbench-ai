/**
 * Typed application errors.
 *
 * Every error that can reach a user goes through `AppError` so the API layer
 * can map it to a stable machine-readable code and an appropriate HTTP status
 * without leaking internals. Anything else that escapes is treated as a 500
 * with a generic message.
 */

export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'provider_error'
  | 'provider_timeout'
  | 'provider_unconfigured'
  | 'payload_too_large'
  | 'internal_error';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  provider_error: 502,
  provider_timeout: 504,
  provider_unconfigured: 503,
  payload_too_large: 413,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Whether the caller can reasonably retry the same request. */
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { details?: unknown; retryable?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options?.details;
    this.retryable =
      options?.retryable ??
      (code === 'rate_limited' ||
        code === 'provider_timeout' ||
        code === 'provider_error');
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError('bad_request', message, { details });

export const notFound = (resource: string, id?: string) =>
  new AppError(
    'not_found',
    id ? `${resource} "${id}" was not found.` : `${resource} was not found.`,
  );

export const unauthorized = (message = 'Authentication is required.') =>
  new AppError('unauthorized', message);

export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError('forbidden', message);

export const conflict = (message: string) => new AppError('conflict', message);

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Narrows an unknown thrown value to a message string, safely. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred.';
}
