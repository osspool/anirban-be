/**
 * SurvivorCase Resource — counseling / referral / service interactions.
 *
 *   POST   /api/survivor-cases             — member logs a case (own survivor)
 *   GET    /api/survivor-cases             — list (members: own; staff: all),
 *                                            filter by `survivorId` / `type`
 *   GET    /api/survivor-cases/:id         — read one by `ANB-CASE-…`
 *   PATCH  /api/survivor-cases/:id         — edit (own/staff)
 *   DELETE /api/survivor-cases/:id         — soft delete (own/staff)
 *   GET    /api/survivor-cases/aggregations/byType — staff stats
 *
 * Filtering by `survivorId` is how the survivor-detail page lists a survivor's
 * timeline of interactions.
 */

import { defineResource } from '@classytic/arc';
import { requireAuth } from '@classytic/arc/permissions';
import { buildCrudSchemasFromModel, QueryParser } from '@classytic/mongokit';
import { createMongooseAdapter } from '@classytic/mongokit/adapter';
import { ownedOrStaff, requireStaff } from '#shared/permissions.js';
import SurvivorCase, { type ISurvivorCase } from './survivor-case.model.js';
import survivorCaseRepository from './survivor-case.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['type', 'survivorId', 'serviceProviderId', 'recordedBy'],
  searchMode: 'regex',
  searchFields: ['caseId', 'counselorName', 'referralSubject', 'serviceType', 'notes'],
});

const survivorCaseResource = defineResource<ISurvivorCase>({
  name: 'survivor-case',
  prefix: '/survivor-cases',
  adapter: createMongooseAdapter({
    model: SurvivorCase,
    repository: survivorCaseRepository,
    schemaGenerator: buildCrudSchemasFromModel,
  }),
  queryParser,
  tenantField: false,
  presets: ['softDelete'],
  idField: 'caseId',

  permissions: {
    create: requireAuth(),
    list: ownedOrStaff(),
    get: ownedOrStaff(),
    update: ownedOrStaff(),
    delete: ownedOrStaff(),
  },

  hooks: {
    beforeCreate: async (ctx) => {
      const uid = ctx.scope?.userId ?? ctx.user?.id ?? ctx.user?._id;
      const name =
        (ctx.user?.name as string | undefined) ?? (ctx.user?.email as string | undefined);
      if (uid) ctx.data.recordedBy = uid;
      if (name) ctx.data.recordedByName = name;
      return ctx.data;
    },
  },

  schemaOptions: {
    fieldRules: {
      caseId: { systemManaged: true },
      recordedBy: { systemManaged: true },
      recordedByName: { systemManaged: true },
      deletedAt: { systemManaged: true },
      createdAt: { systemManaged: true },
      updatedAt: { systemManaged: true },
    },
  },

  aggregations: {
    byType: {
      groupBy: 'type',
      measures: { count: 'count' },
      sort: { count: -1 },
      permissions: requireStaff(),
    },
    // Per-member "who logged how many cases" — feeds the dashboard's
    // member-activity breakdown alongside survivor.byRecorder.
    byRecorder: {
      groupBy: ['recordedBy', 'recordedByName'],
      measures: { count: 'count' },
      sort: { count: -1 },
      permissions: requireStaff(),
    },
  },
});

export default survivorCaseResource;
