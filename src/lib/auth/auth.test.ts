import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractBearerToken,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
  verifyApiKey,
} from '@/lib/auth/api-keys';
import {
  ALL_ROLES,
  hasPermission,
  isAtLeast,
  requirePermission,
} from '@/lib/auth/permissions';
import {
  checkRateLimit,
  getRateLimitStore,
  enforceRateLimit,
  rateLimitHeaders,
  rateLimitIdentity,
} from '@/lib/api/rate-limit';
import { AppError, isAppError, notFound, unauthorized } from '@/lib/core/errors';
import { isValidId, newId } from '@/lib/core/id';

describe('api keys', () => {
  it('generates a prefixed key that hashes to a stored digest', () => {
    const key = generateApiKey();

    expect(key.plaintext.startsWith('pb_')).toBe(true);
    expect(key.hash).toBe(hashApiKey(key.plaintext));
    expect(key.displayPrefix).toBe(key.plaintext.slice(0, 11));
  });

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().plaintext));
    expect(keys.size).toBe(200);
  });

  it('does not store the plaintext anywhere in the hash', () => {
    const key = generateApiKey();
    expect(key.hash).not.toContain(key.plaintext.slice(3));
  });

  it('verifies a correct key and rejects a wrong one', () => {
    const key = generateApiKey();
    expect(verifyApiKey(key.plaintext, key.hash)).toBe(true);
    expect(verifyApiKey('pb_wrong', key.hash)).toBe(false);
  });

  it('recognises well-formed keys only', () => {
    expect(looksLikeApiKey(generateApiKey().plaintext)).toBe(true);
    expect(looksLikeApiKey('pb_short')).toBe(false);
    expect(looksLikeApiKey('sk-openai-style-key-that-is-long-enough')).toBe(false);
  });

  it('extracts a bearer token case-insensitively', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
    expect(extractBearerToken('bearer abc123')).toBe('abc123');
    expect(extractBearerToken('  Bearer   abc123  ')).toBe('abc123');
  });

  it('returns null for a missing or malformed header', () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
  });
});

describe('permissions', () => {
  it('lets every role read', () => {
    for (const role of ALL_ROLES) {
      expect(hasPermission(role, 'prompt:read')).toBe(true);
    }
  });

  it('stops a viewer from spending money on a benchmark run', () => {
    expect(hasPermission('viewer', 'benchmark:run')).toBe(false);
    expect(hasPermission('editor', 'benchmark:run')).toBe(true);
  });

  it('lets a viewer comment, since review is the point of the role', () => {
    expect(hasPermission('viewer', 'comment:write')).toBe(true);
  });

  it('restricts key and member management to admins and above', () => {
    expect(hasPermission('editor', 'apikey:write')).toBe(false);
    expect(hasPermission('admin', 'apikey:write')).toBe(true);
    expect(hasPermission('editor', 'member:invite')).toBe(false);
  });

  it('restricts workspace deletion to the owner', () => {
    expect(hasPermission('admin', 'workspace:delete')).toBe(false);
    expect(hasPermission('owner', 'workspace:delete')).toBe(true);
  });

  it('grants every permission to the owner', () => {
    const permissions = [
      'workspace:delete',
      'apikey:write',
      'benchmark:run',
      'dataset:delete',
    ] as const;
    for (const permission of permissions) {
      expect(hasPermission('owner', permission)).toBe(true);
    }
  });

  it('orders roles strictly', () => {
    expect(isAtLeast('admin', 'editor')).toBe(true);
    expect(isAtLeast('editor', 'admin')).toBe(false);
    expect(isAtLeast('owner', 'owner')).toBe(true);
  });

  it('throws a 403 naming the required role', () => {
    try {
      requirePermission('viewer', 'benchmark:run');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      expect((error as AppError).status).toBe(403);
      expect((error as AppError).message).toContain('editor');
    }
  });
});

describe('rate limiting', () => {
  beforeEach(async () => {
    await getRateLimitStore().reset();
  });

  it('allows requests up to the limit then refuses', async () => {
    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit('user-a', { limit: 3, windowSeconds: 60 });
      expect(result.allowed).toBe(true);
    }

    const blocked = await checkRateLimit('user-a', { limit: 3, windowSeconds: 60 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('counts down the remaining allowance', async () => {
    const first = await checkRateLimit('user-b', { limit: 5, windowSeconds: 60 });
    const second = await checkRateLimit('user-b', { limit: 5, windowSeconds: 60 });

    expect(first.remaining).toBe(4);
    expect(second.remaining).toBe(3);
  });

  it('tracks identities independently', async () => {
    await checkRateLimit('user-c', { limit: 1, windowSeconds: 60 });
    const other = await checkRateLimit('user-d', { limit: 1, windowSeconds: 60 });
    expect(other.allowed).toBe(true);
  });

  it('frees the allowance once the window elapses', async () => {
    // A one-second window keeps this a real assertion rather than a fake timer.
    await checkRateLimit('user-e', { limit: 1, windowSeconds: 1 });
    expect((await checkRateLimit('user-e', { limit: 1, windowSeconds: 1 })).allowed).toBe(
      false,
    );

    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await checkRateLimit('user-e', { limit: 1, windowSeconds: 1 })).allowed).toBe(
      true,
    );
  });

  it('throws a 429 carrying a retry hint', async () => {
    await enforceRateLimit('user-f', { limit: 1, windowSeconds: 60 });

    try {
      await enforceRateLimit('user-f', { limit: 1, windowSeconds: 60 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).status).toBe(429);
      expect((error as AppError).retryable).toBe(true);
      expect((error as AppError).message).toMatch(/retry in/i);
    }
  });

  it('emits standard rate-limit headers', () => {
    const headers = rateLimitHeaders({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: 1_700_000_000_000,
    });

    expect(headers['X-RateLimit-Limit']).toBe('60');
    expect(headers['X-RateLimit-Remaining']).toBe('59');
    expect(headers['X-RateLimit-Reset']).toBe('1700000000');
  });

  it('keys authenticated callers by workspace and user', () => {
    const request = new Request('https://x.test');
    const identity = rateLimitIdentity(request, { userId: 'u1', workspaceId: 'w1' });
    expect(identity).toBe('ws:w1:user:u1');
  });

  it('keys anonymous callers by the leftmost forwarded IP', () => {
    const request = new Request('https://x.test', {
      headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' },
    });
    expect(rateLimitIdentity(request, null)).toBe('ip:203.0.113.7');
  });

  it('falls back to a placeholder when no IP is available', () => {
    expect(rateLimitIdentity(new Request('https://x.test'), null)).toBe('ip:unknown');
  });
});

describe('errors', () => {
  it('maps codes to the right HTTP status', () => {
    expect(new AppError('not_found', 'x').status).toBe(404);
    expect(new AppError('rate_limited', 'x').status).toBe(429);
    expect(new AppError('validation_failed', 'x').status).toBe(422);
    expect(new AppError('provider_timeout', 'x').status).toBe(504);
  });

  it('defaults retryability by class of error', () => {
    expect(new AppError('rate_limited', 'x').retryable).toBe(true);
    expect(new AppError('provider_error', 'x').retryable).toBe(true);
    expect(new AppError('not_found', 'x').retryable).toBe(false);
  });

  it('serialises without leaking the stack', () => {
    const json = new AppError('bad_request', 'Nope', {
      details: { field: 'x' },
    }).toJSON();
    expect(json).toEqual({
      code: 'bad_request',
      message: 'Nope',
      details: { field: 'x' },
    });
    expect(json).not.toHaveProperty('stack');
  });

  it('builds readable messages from the helpers', () => {
    expect(notFound('Prompt', 'p_1').message).toContain('p_1');
    expect(unauthorized().status).toBe(401);
  });
});

describe('ids', () => {
  it('generates prefixed, validatable ids', () => {
    const id = newId('prompt');
    expect(id.startsWith('prompt_')).toBe(true);
    expect(isValidId(id)).toBe(true);
    expect(isValidId(id, 'prompt')).toBe(true);
    expect(isValidId(id, 'run')).toBe(false);
  });

  it('omits look-alike characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(newId('run').split('_')[1]).not.toMatch(/[ilou]/);
    }
  });

  it('rejects malformed ids', () => {
    expect(isValidId('not-an-id')).toBe(false);
    expect(isValidId('run_TOOSHORT')).toBe(false);
  });

  it('does not collide across many generations', () => {
    const ids = new Set(Array.from({ length: 2_000 }, () => newId('row')));
    expect(ids.size).toBe(2_000);
  });
});
