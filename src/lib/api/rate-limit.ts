import { AppError } from '@/lib/core/errors';
import { serverEnv } from '@/lib/env';

/**
 * Sliding-window rate limiter.
 *
 * Backed by an in-process map, which is the right shape for a single-node
 * deployment and for local development. On a horizontally scaled deployment
 * each instance keeps its own window, so the effective limit is
 * `RATE_LIMIT_REQUESTS × instances` — call `setRateLimitStore` with a Redis- or
 * Upstash-backed store to make it global. The interface is deliberately tiny so
 * that swap is a few lines.
 *
 * A true sliding window (timestamp list) is used rather than a fixed window
 * because fixed windows permit a 2x burst across the boundary, which is exactly
 * the case that matters when the limited action costs money.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix ms when the window frees up. */
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number, limit: number): Promise<RateLimitResult>;
  reset(key?: string): Promise<void>;
}

class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  async hit(key: string, windowMs: number, limit: number): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweep(now, windowMs);

    const timestamps = (this.hits.get(key) ?? []).filter((ts) => now - ts < windowMs);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0] ?? now;
      this.hits.set(key, timestamps);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: oldest + windowMs,
      };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    return {
      allowed: true,
      limit,
      remaining: limit - timestamps.length,
      resetAt: (timestamps[0] ?? now) + windowMs,
    };
  }

  async reset(key?: string): Promise<void> {
    if (key) this.hits.delete(key);
    else this.hits.clear();
  }

  /**
   * Drops keys with no recent activity. Without this the map grows unbounded
   * across the lifetime of the process, since every distinct identity that ever
   * made a request would keep an entry forever.
   */
  private sweep(now: number, windowMs: number): void {
    if (now - this.lastSweep < windowMs) return;
    this.lastSweep = now;
    for (const [key, timestamps] of this.hits) {
      const live = timestamps.filter((ts) => now - ts < windowMs);
      if (live.length === 0) this.hits.delete(key);
      else this.hits.set(key, live);
    }
  }
}

let store: RateLimitStore = new MemoryRateLimitStore();

/** Swaps in a distributed store (Redis, Upstash) for multi-instance deploys. */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

export function getRateLimitStore(): RateLimitStore {
  return store;
}

export interface RateLimitOptions {
  limit?: number;
  windowSeconds?: number;
}

export async function checkRateLimit(
  identity: string,
  options?: RateLimitOptions,
): Promise<RateLimitResult> {
  const env = serverEnv();
  const limit = options?.limit ?? env.RATE_LIMIT_REQUESTS;
  const windowMs = (options?.windowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS) * 1000;
  return store.hit(identity, windowMs, limit);
}

/** Checks the limit and throws `429` when exceeded. */
export async function enforceRateLimit(
  identity: string,
  options?: RateLimitOptions,
): Promise<RateLimitResult> {
  const result = await checkRateLimit(identity, options);
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    throw new AppError('rate_limited', `Rate limit exceeded. Retry in ${retryAfter}s.`, {
      details: { retryAfter, limit: result.limit },
    });
  }
  return result;
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
}

/**
 * Derives a stable rate-limit key for a request.
 *
 * Authenticated callers are limited per identity. Anonymous callers fall back
 * to the forwarded client IP; the leftmost `X-Forwarded-For` entry is used
 * because that is the original client, with later entries being proxies.
 */
export function rateLimitIdentity(
  request: Request,
  session?: { userId: string; workspaceId: string } | null,
): string {
  if (session) return `ws:${session.workspaceId}:user:${session.userId}`;
  const forwarded = request.headers.get('x-forwarded-for');
  const ip =
    forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}
