/**
 * AwarenessActivity Resource — member-logged community awareness events.
 *
 *   POST   /api/awareness-activities             — member logs an activity
 *   GET    /api/awareness-activities             — list (members: own; staff: all)
 *   GET    /api/awareness-activities/:id         — read one by `ANB-ACT-…`
 *   PATCH  /api/awareness-activities/:id         — edit (own/staff)
 *   DELETE /api/awareness-activities/:id         — soft delete (own/staff)
 *   GET    /api/awareness-activities/aggregations/totals|byMonth — staff stats
 */

import { defineResource } from '@classytic/arc';
import { requireAuth } from '@classytic/arc/permissions';
import { buildCrudSchemasFromModel, QueryParser } from '@classytic/mongokit';
import { createMongooseAdapter } from '@classytic/mongokit/adapter';
import { ownedOrStaff, requireStaff } from '#shared/permissions.js';
import AwarenessActivity, { type IAwarenessActivity } from './awareness-activity.model.js';
import awarenessActivityRepository from './awareness-activity.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['recordedBy'],
  searchMode: 'regex',
  searchFields: ['name', 'location', 'conductedBy', 'activityId'],
});

const awarenessActivityResource = defineResource<IAwarenessActivity>({
  name: 'awareness-activity',
  prefix: '/awareness-activities',
  adapter: createMongooseAdapter({
    model: AwarenessActivity,
    repository: awarenessActivityRepository,
    schemaGenerator: buildCrudSchemasFromModel,
  }),
  queryParser,
  tenantField: false,
  presets: ['softDelete'],
  idField: 'activityId',

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
      activityId: { systemManaged: true },
      recordedBy: { systemManaged: true },
      recordedByName: { systemManaged: true },
      deletedAt: { systemManaged: true },
      createdAt: { systemManaged: true },
      updatedAt: { systemManaged: true },
    },
  },

  aggregations: {
    totals: {
      measures: { count: 'count', participants: 'sum:totalParticipants' },
      permissions: requireStaff(),
    },
    byMonth: {
      dateBuckets: { month: { field: 'date', interval: 'month' } },
      measures: { count: 'count', participants: 'sum:totalParticipants' },
      sort: { month: 1 },
      permissions: requireStaff(),
    },
  },
});

export default awarenessActivityResource;
