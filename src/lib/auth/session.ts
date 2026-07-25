import { isAppError, unauthorized } from '@/lib/core/errors';
import { newId } from '@/lib/core/id';
import { getRepositories } from '@/lib/db';
import type { MemberRecord, Role, WorkspaceRecord } from '@/lib/db/models';
import { runtimeCapabilities, serverEnv } from '@/lib/env';
import { extractBearerToken, hashApiKey, looksLikeApiKey } from '@/lib/auth/api-keys';

/**
 * Identity resolution.
 *
 * Three authentication paths converge on one `Session`:
 *
 *  1. **API key** — `Authorization: Bearer pb_…`. Machine-to-machine.
 *  2. **Clerk** — a signed-in browser session, when Clerk is configured.
 *  3. **Local** — a single built-in identity when Clerk is not configured, so
 *     a fresh clone is usable immediately.
 *
 * Path 3 is the one worth being explicit about: it is *not* an auth bypass in
 * production. Once `CLERK_SECRET_KEY` is set, `runtimeCapabilities().managedAuth`
 * flips and the local identity is refused outright. Local identity only exists
 * for an installation that has deliberately chosen not to configure auth.
 */

export interface Session {
  userId: string;
  email: string;
  displayName: string;
  workspaceId: string;
  workspaceSlug: string;
  role: Role;
  /** How this request authenticated. */
  via: 'clerk' | 'api_key' | 'local';
}

export const LOCAL_USER = {
  id: 'user_local0000000000000',
  email: 'you@localhost',
  displayName: 'Local User',
} as const;

export const LOCAL_WORKSPACE = {
  id: 'ws_local00000000000000',
  name: 'Personal Workspace',
  slug: 'personal',
} as const;

/**
 * Ensures the local workspace and its owner membership exist.
 *
 * Idempotent — safe to call on every request. This is what makes the app
 * immediately usable with no signup flow.
 */
export async function ensureLocalWorkspace(): Promise<{
  workspace: WorkspaceRecord;
  member: MemberRecord;
}> {
  const repos = getRepositories();

  let workspace = await repos.workspaces.findById(LOCAL_WORKSPACE.id);

  if (!workspace) {
    // Next renders a layout and its page concurrently, so two calls can both
    // observe "not found" and both attempt to create. Rather than serialising
    // with a lock, treat the conflict as proof the other writer won and read
    // its row back — the same shape a unique-constraint violation takes on
    // Postgres, so both drivers behave identically here.
    try {
      workspace = await repos.workspaces.create({
        id: LOCAL_WORKSPACE.id,
        name: LOCAL_WORKSPACE.name,
        slug: LOCAL_WORKSPACE.slug,
        externalId: null,
      });
    } catch (error) {
      if (!isAppError(error) || error.code !== 'conflict') throw error;
      workspace =
        (await repos.workspaces.findById(LOCAL_WORKSPACE.id)) ??
        (await repos.workspaces.findBySlug(LOCAL_WORKSPACE.slug));
      if (!workspace) throw error;
    }
  }

  let member = await repos.members.find(workspace.id, LOCAL_USER.id);

  if (!member) {
    try {
      member = await repos.members.add({
        id: newId('user'),
        workspaceId: workspace.id,
        userId: LOCAL_USER.id,
        email: LOCAL_USER.email,
        displayName: LOCAL_USER.displayName,
        role: 'owner',
      });
    } catch (error) {
      if (!isAppError(error) || error.code !== 'conflict') throw error;
      member = await repos.members.find(workspace.id, LOCAL_USER.id);
      if (!member) throw error;
    }
  }

  return { workspace, member };
}

async function sessionFromApiKey(token: string): Promise<Session | null> {
  const repos = getRepositories();
  const record = await repos.apiKeys.findByHash(hashApiKey(token));

  if (!record || record.revokedAt) return null;

  const workspace = await repos.workspaces.findById(record.workspaceId);
  if (!workspace) return null;

  // Record usage without blocking the request on the write.
  void repos.apiKeys.touch(record.id);

  return {
    userId: record.createdBy,
    email: 'api-key@promptbench',
    displayName: `API key: ${record.name}`,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    // Keys inherit editor rights: enough to run benchmarks and manage prompts,
    // not enough to manage members or mint further keys.
    role: 'editor',
    via: 'api_key',
  };
}

/**
 * Resolves the Clerk session for a request.
 *
 * Clerk's server helper is imported lazily so the package is never evaluated
 * in an installation that has not configured it — importing `@clerk/nextjs/server`
 * eagerly throws when its keys are absent.
 */
async function sessionFromClerk(): Promise<Session | null> {
  const { auth } = await import('@clerk/nextjs/server');
  const { userId, orgId, orgSlug, orgRole } = await auth();
  if (!userId) return null;

  const repos = getRepositories();

  // Personal (non-org) sessions get a workspace keyed to the Clerk user id.
  const externalId = orgId ?? `user:${userId}`;
  let workspace = await repos.workspaces.findByExternalId(externalId);

  workspace ??= await repos.workspaces.create({
    id: newId('ws'),
    name: orgSlug ? `${orgSlug} workspace` : 'Personal Workspace',
    slug: orgSlug ?? `u-${userId.slice(-8).toLowerCase()}`,
    externalId,
  });

  const role = mapClerkRole(orgRole, Boolean(orgId));

  let member = await repos.members.find(workspace.id, userId);
  member ??= await repos.members.add({
    id: newId('user'),
    workspaceId: workspace.id,
    userId,
    email: 'member@workspace',
    displayName: 'Member',
    role,
  });

  return {
    userId,
    email: member.email,
    displayName: member.displayName,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    role: member.role,
    via: 'clerk',
  };
}

function mapClerkRole(orgRole: string | null | undefined, inOrg: boolean): Role {
  if (!inOrg) return 'owner';
  switch (orgRole) {
    case 'org:admin':
      return 'admin';
    case 'org:member':
      return 'editor';
    default:
      return 'viewer';
  }
}

/**
 * Resolves the session for the current request, or null when anonymous.
 *
 * `headers` is passed in rather than read from `next/headers` so this is
 * callable from route handlers, server components and tests alike.
 */
export async function getSession(headers?: Headers): Promise<Session | null> {
  const capabilities = runtimeCapabilities(serverEnv());

  const token = extractBearerToken(headers?.get('authorization') ?? null);
  if (token && looksLikeApiKey(token)) {
    return sessionFromApiKey(token);
  }

  if (capabilities.managedAuth) {
    return sessionFromClerk();
  }

  const { workspace, member } = await ensureLocalWorkspace();
  return {
    userId: LOCAL_USER.id,
    email: LOCAL_USER.email,
    displayName: LOCAL_USER.displayName,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    role: member.role,
    via: 'local',
  };
}

/** Resolves the session or throws `401`. */
export async function requireSession(headers?: Headers): Promise<Session> {
  const session = await getSession(headers);
  if (!session) {
    throw unauthorized(
      'Sign in, or supply an API key via the Authorization: Bearer header.',
    );
  }
  return session;
}
