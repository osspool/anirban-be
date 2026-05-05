/**
 * SupportRequest Resource
 *
 * Public complaint / help submission with an admin-managed workflow.
 *
 * Endpoint surface (auto-generated from `defineResource`):
 *
 *   POST   /api/support-requests                 — anyone files a complaint
 *   GET    /api/support-requests/:id             — public read (id is the
 *                                                   submitter's tracking handle)
 *   GET    /api/support-requests                 — committee/admin list
 *   PATCH  /api/support-requests/:id             — committee+ edit (assign,
 *                                                   priority)
 *   DELETE /api/support-requests/:id             — admin archive (soft)
 *
 *   POST   /api/support-requests/:id/start-review        — pending → in_review
 *   POST   /api/support-requests/:id/escalate-to-ministry — in_review → in_ministry
 *   POST   /api/support-requests/:id/resolve             — * → resolved
 *   POST   /api/support-requests/:id/close               — * → closed
 *   POST   /api/support-requests/:id/reopen              — resolved/closed → in_review
 *   POST   /api/support-requests/:id/note                — committee+ adds a free-form note
 *
 * Every action appends to `timeline[]` via `mongoose-timeline-audit`,
 * recording actor (committee/admin/system), event type, and metadata.
 * The frontend reads `timeline[]` straight off the doc — no separate
 * audit endpoint.
 */

import { defineResource } from '@classytic/arc';
import { getEntityQuery } from '@classytic/arc/core';
import { allowPublic, anyOf, requireRoles } from '@classytic/arc/permissions';
import { NotFoundError, ValidationError } from '@classytic/arc/utils';
import { buildCrudSchemasFromModel, QueryParser } from '@classytic/mongokit';
import { createMongooseAdapter } from '@classytic/mongokit/adapter';
import SupportRequest, {
  type ISupportRequest,
  type SupportRequestStatus,
} from './support-request.model.js';
import supportRequestRepository from './support-request.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['status', 'category', 'priority', 'assignedTo'],
});

/** Roles allowed to drive the workflow. */
const committeeOrAdmin = anyOf(requireRoles(['admin']), requireRoles(['committee_member']));

/** Allowed transitions — single source of truth for the workflow FSM. */
const TRANSITIONS: Record<string, { from: SupportRequestStatus[]; to: SupportRequestStatus }> = {
  startReview: { from: ['pending'], to: 'in_review' },
  escalateToMinistry: { from: ['in_review'], to: 'in_ministry' },
  resolve: { from: ['in_review', 'in_ministry'], to: 'resolved' },
  close: { from: ['pending', 'in_review', 'in_ministry', 'resolved'], to: 'closed' },
  reopen: { from: ['resolved', 'closed'], to: 'in_review' },
};

/**
 * Apply a workflow transition. Validates the source state, updates
 * `status`, and appends a `support.<eventType>` event to the timeline
 * via the model's `addTimelineEvent` instance method.
 */
async function applyTransition(
  _id: string,
  action: keyof typeof TRANSITIONS,
  data: Record<string, unknown>,
  // biome-ignore lint/suspicious/noExplicitAny: arc forwards FastifyRequest with extras
  req: any,
): Promise<unknown> {
  // `getEntityQuery(req)` returns `{ [idField]: entityId }` — honours the
  // resource's `idField: 'reportId'` binding so swapping the route key
  // never silently breaks lookups (the historical `findById(id)` footgun).
  const doc = await SupportRequest.findOne(getEntityQuery(req));
  if (!doc) throw new NotFoundError('SupportRequest');

  const { from, to } = TRANSITIONS[action];
  if (!from.includes(doc.status)) {
    throw new ValidationError(
      `Cannot ${action} a request in status "${doc.status}" (expected one of: ${from.join(', ')})`,
    );
  }

  doc.status = to;
  // Optional `note` is captured both in the timeline event description
  // AND as an event-metadata blob — the FE renders both.
  const note = typeof data.note === 'string' ? data.note.trim() : '';
  const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};

  // mongoose-timeline-audit instance method — `event`, `description`,
  // `request`, `metadata`. Actor (admin/committee/system) is auto-resolved
  // from `request.user`.
  // biome-ignore lint/suspicious/noExplicitAny: plugin extends prototype dynamically
  (doc as any).addTimelineEvent(
    `support.${action}`,
    note || `Status changed to ${to}`,
    req,
    { from: from.join('|'), to, ...metadata },
  );

  await doc.save();
  return doc.toObject();
}

const supportRequestResource = defineResource<ISupportRequest>({
  name: 'support-request',
  prefix: '/support-requests',
  adapter: createMongooseAdapter({
    model: SupportRequest,
    repository: supportRequestRepository,
    schemaGenerator: buildCrudSchemasFromModel,
  }),
  queryParser,
  presets: ['softDelete'],
  // Single-tenant: foundation-wide, no per-org scoping.
  tenantField: false,

  // Route :id binds to the human-friendly `reportId` (`ANB-2026-0001`).
  // The submitter pastes that into `/track` — much friendlier than the
  // raw ObjectId. mongokit's customIdPlugin stamps it on create.
  idField: 'reportId',

  permissions: {
    // Anyone files a complaint.
    create: allowPublic(),
    // Anyone with the id can check status — the id IS the tracking token.
    // (For high-sensitivity deployments, swap to `requireRoles` and email
    // the submitter a signed link instead.)
    get: allowPublic(),
    // Triage is committee/admin only.
    list: committeeOrAdmin,
    update: committeeOrAdmin,
    // Archive is admin-only.
    delete: requireRoles(['admin']),
  },

  schemaOptions: {
    fieldRules: {
      // The customIdPlugin stamps `reportId` on create — never accept
      // it from a client (would let attackers collide with a real case).
      reportId: { systemManaged: true },
      // Status drives the FSM and is owned by the action router (never
      // by direct PATCH from a client). arc 2.14 separated `systemManaged`
      // (write rule) from visibility/aggregation rules, so locking the
      // write path no longer blocks the dashboard's `byStatus` groupBy.
      status: { systemManaged: true },
      timeline: { systemManaged: true },
      // `assignedTo` IS settable via PATCH for triage — stays writable.
    },
  },

  // ─── Aggregations (arc 2.13+) ──────────────────────────────────────
  // Drives the dashboard's "Open / Resolved" badges via a single
  // `GET /api/support-requests/aggregations/byStatus` call. The FE
  // sums the right buckets — much cheaper than fetching `limit: 100`
  // and post-filtering client-side, and stays fresh because every
  // CRUD write auto-invalidates `KEYS.aggregations()` on the SDK side.
  aggregations: {
    byStatus: {
      groupBy: 'status',
      measures: { count: 'count' },
      sort: { count: -1 },
      // Match the list permission — triage stats are committee/admin only.
      permissions: committeeOrAdmin,
    },
  },

  actions: {
    startReview: {
      description: 'Move pending request into review',
      permissions: committeeOrAdmin,
      handler: (id, data, req) => applyTransition(id, 'startReview', data, req),
    },
    escalateToMinistry: {
      description: 'Escalate to the relevant ministry / authority',
      permissions: committeeOrAdmin,
      handler: (id, data, req) => applyTransition(id, 'escalateToMinistry', data, req),
    },
    resolve: {
      description: 'Mark the request resolved with a closing note',
      permissions: committeeOrAdmin,
      handler: (id, data, req) => applyTransition(id, 'resolve', data, req),
    },
    close: {
      description: 'Close without resolution (e.g. duplicate, withdrawn)',
      permissions: committeeOrAdmin,
      handler: (id, data, req) => applyTransition(id, 'close', data, req),
    },
    reopen: {
      description: 'Reopen a resolved / closed request',
      permissions: committeeOrAdmin,
      handler: (id, data, req) => applyTransition(id, 'reopen', data, req),
    },

    note: {
      description: 'Append a free-form note to the timeline without changing status',
      permissions: committeeOrAdmin,
      handler: async (_id, data, req) => {
        const doc = await SupportRequest.findOne(getEntityQuery(req));
        if (!doc) throw new NotFoundError('SupportRequest');

        const text = String(data.note ?? '').trim();
        if (text.length < 1) throw new ValidationError('note cannot be empty');

        // biome-ignore lint/suspicious/noExplicitAny: plugin extends prototype dynamically
        (doc as any).addTimelineEvent('support.note_added', text, req, {});
        await doc.save();
        return doc.toObject();
      },
    },
  },
});

export default supportRequestResource;
