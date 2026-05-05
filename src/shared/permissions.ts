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
