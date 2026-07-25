import { forbidden } from '@/lib/core/errors';
import type { Role } from '@/lib/db/models';

/**
 * Role-based permissions.
 *
 * Roles are strictly ordered, so a permission check is a rank comparison rather
 * than a per-role capability matrix that drifts out of sync. Every action
 * declares the minimum rank it needs, once, here.
 */

const RANK: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

export type Permission =
  | 'workspace:read'
  | 'workspace:update'
  | 'workspace:delete'
  | 'member:invite'
  | 'member:update_role'
  | 'member:remove'
  | 'prompt:read'
  | 'prompt:write'
  | 'prompt:delete'
  | 'benchmark:read'
  | 'benchmark:run'
  | 'benchmark:delete'
  | 'dataset:read'
  | 'dataset:write'
  | 'dataset:delete'
  | 'comment:read'
  | 'comment:write'
  | 'apikey:read'
  | 'apikey:write';

const REQUIRED_ROLE: Record<Permission, Role> = {
  'workspace:read': 'viewer',
  'workspace:update': 'admin',
  'workspace:delete': 'owner',

  'member:invite': 'admin',
  'member:update_role': 'admin',
  'member:remove': 'admin',

  'prompt:read': 'viewer',
  'prompt:write': 'editor',
  'prompt:delete': 'editor',

  'benchmark:read': 'viewer',
  // Running a benchmark spends money, so viewers cannot trigger one.
  'benchmark:run': 'editor',
  'benchmark:delete': 'editor',

  'dataset:read': 'viewer',
  'dataset:write': 'editor',
  'dataset:delete': 'editor',

  'comment:read': 'viewer',
  // Commenting is the one write a viewer gets — review is the point of the role.
  'comment:write': 'viewer',

  'apikey:read': 'admin',
  'apikey:write': 'admin',
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return RANK[role] >= RANK[REQUIRED_ROLE[permission]];
}

/** Throws `403` when the role is insufficient. */
export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw forbidden(
      `This action requires the "${REQUIRED_ROLE[permission]}" role or higher; you have "${role}".`,
    );
  }
}

export function isAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

export const ALL_ROLES: Role[] = ['viewer', 'editor', 'admin', 'owner'];

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: 'Read everything and leave comments. Cannot run benchmarks.',
  editor: 'Create prompts, upload datasets, and run benchmarks.',
  admin: 'Everything an editor can do, plus manage members and API keys.',
  owner: 'Full control, including deleting the workspace.',
};
