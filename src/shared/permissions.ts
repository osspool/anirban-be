/**
 * Permission Helpers
 *
 * Clean, type-safe permission definitions for resources.
 */

import {
  requireAuth,
  requireRoles,
  requireOwnership,
  allowPublic,
  roles,
  anyOf,
  allOf,
  denyAll,
  when,
  type PermissionCheck,
} from '@classytic/arc/permissions';

// Re-export core helpers
export {
  allowPublic,
  requireAuth,
  requireRoles,
  requireOwnership,
  roles,
  allOf,
  anyOf,
  denyAll,
  when,
};

// ============================================================================
// Permission Helpers
// ============================================================================

/**
 * Require any authenticated user
 */
export const requireAuthenticated = (): PermissionCheck =>
  requireRoles(['user', 'admin', 'superadmin']);

/**
 * Require admin or superadmin
 */
export const requireAdmin = (): PermissionCheck =>
  requireRoles(['admin', 'superadmin']);

/**
 * Require superadmin only
 */
export const requireSuperadmin = (): PermissionCheck =>
  requireRoles(['superadmin']);

// ============================================================================
// Casework (MIS) helpers — survivor / case / awareness ownership model
// ============================================================================

/**
 * Foundation staff — see + manage EVERY record. `committee_member` runs the
 * day-to-day casework; `admin` / `superadmin` sit above them. Anything below
 * (a `general` member) is scoped to the rows they recorded themselves.
 */
export const STAFF_ROLES = ['superadmin', 'admin', 'committee_member'] as const;

/** Admin/committee/superadmin gate — directory curation + aggregate stats. */
export const requireStaff = (): PermissionCheck => requireRoles([...STAFF_ROLES]);

/**
 * Ownership gate for member-recorded resources (survivor / survivor-case /
 * awareness-activity). Staff bypass entirely (full read/write). Everyone else
 * is transparently narrowed to `{ recordedBy: <their userId> }` on
 * list / get / update / delete — arc merges the returned `filters` into
 * `_policyFilters`, so a `general` member only ever sees rows they created.
 *
 * Pairs with a `beforeCreate` hook that stamps `recordedBy` from the request
 * scope, so the owner is set server-side and can't be spoofed by the client.
 */
export const ownedOrStaff = (): PermissionCheck =>
  requireOwnership('recordedBy', { bypassRoles: [...STAFF_ROLES] });

// ============================================================================
// Standard Permission Sets
// ============================================================================

/**
 * Public read, authenticated write (default for most resources)
 */
export const publicReadPermissions = {
  list: allowPublic(),
  get: allowPublic(),
  create: requireAuthenticated(),
  update: requireAuthenticated(),
  delete: requireAuthenticated(),
};

/**
 * All operations require authentication
 */
export const authenticatedPermissions = {
  list: requireAuth(),
  get: requireAuth(),
  create: requireAuth(),
  update: requireAuth(),
  delete: requireAuth(),
};

/**
 * Admin only permissions
 */
export const adminPermissions = {
  list: requireAdmin(),
  get: requireAdmin(),
  create: requireSuperadmin(),
  update: requireSuperadmin(),
  delete: requireSuperadmin(),
};
