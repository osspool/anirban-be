/**
 * MembershipRequest Resource
 *
 * Public application form for survivors who want to join the foundation.
 *
 * Endpoint surface (auto-derived from `defineResource` — no custom actions
 * needed; FE drives the BA invite via `authClient.organization.inviteMember`
 * after toggling status here):
 *
 *   POST   /api/membership-requests       — public submission (anyone)
 *   GET    /api/membership-requests       — admin lists (filter by status)
 *   GET    /api/membership-requests/:id   — admin reads one
 *   PATCH  /api/membership-requests/:id   — admin sets status, rejectionReason,
 *                                           or invitationId once BA returns it
 *   DELETE /api/membership-requests/:id   — admin archives (soft)
 *
 * Frontend approval flow (single browser session):
 *   1. PATCH `{ status: 'approved' }` here, optionally store the
 *      `invitationId` returned in step 2.
 *   2. `await authClient.organization.inviteMember({ email, role,
 *      organizationId })` — BA owns the email + accept link entirely.
 *
 * Frontend rejection flow:
 *   PATCH `{ status: 'rejected', rejectionReason: '<why>' }` — done.
 *
 * No DIY user creation, no auth-API-from-the-server detour.
 */

import { defineResource } from '@classytic/arc';
import { allowPublic, requireRoles } from '@classytic/arc/permissions';
import { buildCrudSchemasFromModel, QueryParser } from '@classytic/mongokit';
import { createMongooseAdapter } from '@classytic/mongokit/adapter';
import MembershipRequest, { type IMembershipRequest } from './membership-request.model.js';
import membershipRequestRepository from './membership-request.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['status', 'email', 'division', 'districtLabel'],
});

const membershipRequestResource = defineResource<IMembershipRequest>({
  name: 'membership-request',
  prefix: '/membership-requests',
  adapter: createMongooseAdapter({
    model: MembershipRequest,
    repository: membershipRequestRepository,
    schemaGenerator: buildCrudSchemasFromModel,
  }),
  queryParser,
  presets: ['softDelete'],
  // Single-tenant: foundation-wide, no per-org scoping on the request.
  tenantField: false,

  permissions: {
    // Anyone can apply.
    create: allowPublic(),
    // Admin reviews + manages.
    list: requireRoles(['admin']),
    get: requireRoles(['admin']),
    update: requireRoles(['admin']),
    delete: requireRoles(['admin']),
  },

  schemaOptions: {
    fieldRules: {
      // Lock the audit trail to admin PATCH (`reviewedBy` / `reviewedAt`
      // are the only places we want server-stamped values; status flow
      // is admin-driven via PATCH).
      reviewedBy: { systemManaged: true },
      reviewedAt: { systemManaged: true },
    },
  },
});

export default membershipRequestResource;
