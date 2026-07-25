import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepositories } from '@/lib/db/memory';
import { getRepositories, resetRepositories, setRepositories } from '@/lib/db';
import {
  ensureLocalWorkspace,
  getSession,
  requireSession,
  LOCAL_USER,
  LOCAL_WORKSPACE,
} from '@/lib/auth/session';
import { generateApiKey } from '@/lib/auth/api-keys';
import { newId } from '@/lib/core/id';
import { railBounds, seriesIndex } from '@/lib/utils/bounds';
import { cn } from '@/lib/utils/cn';

/**
 * Session resolution.
 *
 * Security-relevant: these tests pin which credential yields which identity and
 * role, and confirm that a revoked or unknown key yields none.
 */

beforeEach(() => {
  resetRepositories();
  setRepositories(new MemoryRepositories());
});

function withKey(plaintext: string): Headers {
  return new Headers({ authorization: `Bearer ${plaintext}` });
}

async function seedApiKey(options?: { revoked?: boolean; workspaceId?: string }) {
  const repos = getRepositories();
  const workspaceId = options?.workspaceId ?? newId('ws');

  await repos.workspaces.create({
    id: workspaceId,
    name: 'Key workspace',
    slug: `slug-${workspaceId.slice(-6)}`,
    externalId: null,
  });

  const generated = generateApiKey();
  await repos.apiKeys.create({
    id: newId('key'),
    workspaceId,
    name: 'CI',
    keyHash: generated.hash,
    keyPrefix: generated.displayPrefix,
    lastUsedAt: null,
    revokedAt: options?.revoked ? new Date().toISOString() : null,
    createdBy: 'user_creator',
  });

  return { generated, workspaceId };
}

describe('ensureLocalWorkspace', () => {
  it('creates the workspace and an owner membership', async () => {
    const { workspace, member } = await ensureLocalWorkspace();

    expect(workspace.id).toBe(LOCAL_WORKSPACE.id);
    expect(member.userId).toBe(LOCAL_USER.id);
    expect(member.role).toBe('owner');
  });

  it('is idempotent across repeated calls', async () => {
    const first = await ensureLocalWorkspace();
    const second = await ensureLocalWorkspace();

    expect(second.workspace.id).toBe(first.workspace.id);
    expect(second.member.id).toBe(first.member.id);
    expect((await getRepositories().members.list(first.workspace.id)).length).toBe(1);
  });

  it('survives concurrent callers racing to create it', async () => {
    // Next renders a layout and its page concurrently, so both can observe
    // "not found" and both attempt the insert.
    const results = await Promise.all([
      ensureLocalWorkspace(),
      ensureLocalWorkspace(),
      ensureLocalWorkspace(),
    ]);

    const ids = new Set(results.map((r) => r.workspace.id));
    expect(ids.size).toBe(1);
    expect((await getRepositories().members.list(LOCAL_WORKSPACE.id)).length).toBe(1);
  });
});

describe('getSession', () => {
  it('falls back to the local identity when no credential is supplied', async () => {
    const session = await getSession();

    expect(session?.via).toBe('local');
    expect(session?.userId).toBe(LOCAL_USER.id);
    expect(session?.role).toBe('owner');
  });

  it('resolves a valid API key to its workspace with editor rights', async () => {
    const { generated, workspaceId } = await seedApiKey();
    const session = await getSession(withKey(generated.plaintext));

    expect(session?.via).toBe('api_key');
    expect(session?.workspaceId).toBe(workspaceId);
    // Keys can run benchmarks but must not manage members or mint more keys.
    expect(session?.role).toBe('editor');
  });

  it('records the key as used', async () => {
    const { generated, workspaceId } = await seedApiKey();
    await getSession(withKey(generated.plaintext));

    // The touch is fire-and-forget, so let the microtask queue drain.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [key] = await getRepositories().apiKeys.list(workspaceId);
    expect(key?.lastUsedAt).not.toBeNull();
  });

  it('refuses a revoked key', async () => {
    const { generated } = await seedApiKey({ revoked: true });
    expect(await getSession(withKey(generated.plaintext))).toBeNull();
  });

  it('refuses an unknown key', async () => {
    const unknown = generateApiKey();
    expect(await getSession(withKey(unknown.plaintext))).toBeNull();
  });

  it('refuses a key whose workspace no longer exists', async () => {
    const { generated, workspaceId } = await seedApiKey();
    await getRepositories().workspaces.delete(workspaceId);

    expect(await getSession(withKey(generated.plaintext))).toBeNull();
  });

  it('ignores a bearer token that is not an API key', async () => {
    // A Clerk JWT or unrelated token must not be treated as a key; it falls
    // through to the configured auth path instead.
    const session = await getSession(
      new Headers({ authorization: 'Bearer eyJhbGciOi.abc' }),
    );
    expect(session?.via).toBe('local');
  });

  it('ignores a non-bearer authorization scheme', async () => {
    const session = await getSession(
      new Headers({ authorization: 'Basic dXNlcjpwYXNz' }),
    );
    expect(session?.via).toBe('local');
  });
});

describe('requireSession', () => {
  it('returns the session when one resolves', async () => {
    expect((await requireSession()).userId).toBe(LOCAL_USER.id);
  });

  it('throws 401 when a supplied key is invalid', async () => {
    const unknown = generateApiKey();
    await expect(requireSession(withKey(unknown.plaintext))).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('railBounds', () => {
  it('finds the extremes of a sample', () => {
    expect(railBounds([3, 1, 4, 1, 5])).toEqual({ min: 1, max: 5 });
  });

  it('ignores nulls, undefined and non-finite values', () => {
    expect(railBounds([10, null, undefined, NaN, Infinity, 20])).toEqual({
      min: 10,
      max: 20,
    });
  });

  it('returns a zero range for an empty sample', () => {
    expect(railBounds([])).toEqual({ min: 0, max: 0 });
    expect(railBounds([null, undefined])).toEqual({ min: 0, max: 0 });
  });

  it('collapses to a point when every value is equal', () => {
    expect(railBounds([7, 7, 7])).toEqual({ min: 7, max: 7 });
  });
});

describe('seriesIndex', () => {
  it('assigns a stable 1-based index per model', () => {
    const models = ['a', 'b', 'c'];
    expect(seriesIndex('a', models)).toBe(1);
    expect(seriesIndex('c', models)).toBe(3);
  });

  it('wraps past the eight-colour ramp', () => {
    const models = Array.from({ length: 10 }, (_, i) => `m${i}`);
    expect(seriesIndex('m8', models)).toBe(1);
  });

  it('defaults to the first series for an unknown model', () => {
    expect(seriesIndex('missing', ['a'])).toBe(1);
  });
});

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('resolves conflicting Tailwind utilities so the last wins', () => {
    // This is what makes a caller's className override a component default
    // predictably, rather than depending on stylesheet order.
    expect(cn('px-4', 'px-6')).toBe('px-6');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('keeps non-conflicting utilities', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
  });
});
