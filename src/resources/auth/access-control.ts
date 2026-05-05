/**
 * Access Control — Anirban Survivor Voice Foundation
 *
 * Single logical org (the foundation). Three org-level roles via BA's
 * `organization` plugin AC system:
 *
 *   admin             — full control: review/approve membership requests,
 *                       manage members, full support-request workflow.
 *   committee_member  — handle support-request workflow (review,
 *                       escalate, resolve, close).
 *   general           — basic survivor member; read public + own.
 *
 * **Multiple roles per user** are supported natively. BA stores the
 * `member.role` field as a **comma-separated string** (e.g.
 * `'admin,committee_member'`) and splits on `,` for permission checks.
 * arc's `requireRoles(['admin'])` matches any role in the union, so an
 * "executive" can be both `admin` AND `committee_member` simultaneously
 * without role-inheritance plumbing. Add a member to the union via
 * `auth.api.updateMemberRole({ memberId, role: 'admin,committee_member' })`
 * from the frontend.
 *
 * Statements stay narrow on purpose — these map to the resource verbs the
 * frontend calls, nothing more. Add new statement keys as new resources
 * land.
 */

import { createAccessControl } from 'better-auth/plugins/access';

export const statements = {
  organization: ['read', 'update'],
  member: ['create', 'read', 'update', 'delete'],
  invitation: ['create', 'read', 'cancel'],
  membership_request: ['read', 'approve', 'reject', 'delete'],
  support_request: ['read', 'review', 'escalate', 'resolve', 'close', 'delete'],
} as const;

export const ac = createAccessControl(statements);

/** Foundation admin — full surface. */
export const admin = ac.newRole({
  organization: ['read', 'update'],
  member: ['create', 'read', 'update', 'delete'],
  invitation: ['create', 'read', 'cancel'],
  membership_request: ['read', 'approve', 'reject', 'delete'],
  support_request: ['read', 'review', 'escalate', 'resolve', 'close', 'delete'],
});

/** Committee member — runs the support workflow, reads members. */
export const committee_member = ac.newRole({
  organization: ['read'],
  member: ['read'],
  invitation: [],
  membership_request: ['read'],
  support_request: ['read', 'review', 'escalate', 'resolve', 'close'],
});

/** General member — survivor in the network; read-only on directory. */
export const general = ac.newRole({
  organization: ['read'],
  member: ['read'],
  invitation: [],
  membership_request: [],
  support_request: ['read'],
});
