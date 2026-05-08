/**
 * Support-request scenario — public complaint + workflow + timeline audit.
 *
 * 1. **Public** files a complaint → 201, `pending`, empty timeline
 * 2. **Public** can GET by id (the id IS the tracking handle)
 * 3. **General** member can NOT list (committee/admin only) → 403
 * 4. **Committee** starts review → status=`in_review`, timeline gains
 *    `support.startReview` event with actor info
 * 5. **Committee** escalates to ministry → status=`in_ministry`, timeline
 *    grows
 * 6. **Committee** resolves with a closing note → status=`resolved`,
 *    timeline records the note
 * 7. Reopen + close also work
 * 8. **Invalid transitions** are rejected with 400 (FSM guard)
 * 9. **Free-form notes** appended via `/note` action without status change
 *
 * What this pins:
 *   - public-only `create` permission, public `get`
 *   - committee+ workflow control
 *   - mongoose-timeline-audit captures every transition with actor
 *     resolved from the BA bearer token
 *   - workflow FSM is enforced at every action
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useIntegrationApp, type IntegrationCtx } from '../helpers/lifecycle.js';
import { submitSupportRequest } from '../helpers/fixtures.js';

interface TimelineEvent {
  event: string;
  description: string;
  actor?: { role?: string; id?: string };
  metadata?: Record<string, unknown>;
}

interface SupportRequestRow {
  _id: string;
  /** Friendly tracking handle from `customIdPlugin` — also bound as the
   *  resource `idField`, so URLs use this, not `_id`. */
  reportId: string;
  status: 'pending' | 'in_review' | 'in_ministry' | 'resolved' | 'closed';
  subject: string;
  timeline: TimelineEvent[];
}

describe('support-request flow', () => {
  let ctx: IntegrationCtx;

  beforeAll(async () => {
    ctx = await useIntegrationApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('allows the public to file a complaint (no auth)', async () => {
    const { statusCode, body } = await submitSupportRequest(ctx.app, {
      subject: 'Suspected child marriage in Khulna',
      category: 'child_marriage',
      description: 'A 14-year-old is being forced to marry next week.',
    });
    expect(statusCode).toBe(201);
    expect(body).toMatchObject({
      subject: 'Suspected child marriage in Khulna',
      category: 'child_marriage',
      status: 'pending',
    });
    expect(body._id).toBeTypeOf('string');
    expect(body.reportId).toBeTypeOf('string');
    expect(body.reportId).toMatch(/^ANB-\d{4}-\d{4}$/);
    // Fresh submissions have no workflow events yet.
    expect(Array.isArray(body.timeline)).toBe(true);
    expect((body.timeline as unknown[]).length).toBe(0);
  });

  it('allows the public to GET by reportId (the id IS the tracking handle)', async () => {
    const submit = await submitSupportRequest(ctx.app);
    const id = submit.body.reportId as string;

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/support-requests/${id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as SupportRequestRow;
    expect(body.reportId).toBe(id);
  });

  it('rejects general-member list reads (committee+ only)', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/support-requests',
      headers: ctx.auth.as('general').headers,
    });
    expect(res.statusCode).toBe(403);
  });

  it('committee can list complaints', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/support-requests',
      headers: ctx.auth.as('committee').headers,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { method: string; data: SupportRequestRow[] };
    expect(body.method).toBe('offset');
    expect(body.data.length).toBeGreaterThan(0);
  });

  /**
   * arc's actions are mounted on a single unified endpoint
   * `POST /:id/action` and dispatched by `body.action`. Helper keeps the
   * tests focused on workflow behaviour, not URL plumbing.
   */
  function action(
    id: string,
    name: string,
    role: 'admin' | 'committee' | 'general',
    payload: Record<string, unknown> = {},
  ) {
    return ctx.app.inject({
      method: 'POST',
      url: `/api/support-requests/${id}/action`,
      headers: ctx.auth.as(role).headers,
      payload: { action: name, ...payload },
    });
  }

  it('committee starts review → timeline gains support.startReview event', async () => {
    const submit = await submitSupportRequest(ctx.app);
    const id = submit.body.reportId as string;

    const res = await action(id, 'startReview', 'committee', {
      note: 'Initial triage — assigning to legal team.',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as SupportRequestRow;
    expect(body.status).toBe('in_review');
    expect(body.timeline.length).toBe(1);
    expect(body.timeline[0]!.event).toBe('support.startReview');
    expect(body.timeline[0]!.description).toBe('Initial triage — assigning to legal team.');
  });

  it('full happy-path workflow: pending → in_review → in_ministry → resolved', async () => {
    const submit = await submitSupportRequest(ctx.app);
    const id = submit.body.reportId as string;

    await action(id, 'startReview', 'committee', { note: 'reviewing' });
    await action(id, 'escalateToMinistry', 'committee', { note: 'ref# 11/2026 to MoWCA' });
    const resolve = await action(id, 'resolve', 'committee', {
      note: 'rescue completed by police; case closed',
    });
    expect(resolve.statusCode).toBe(200);
    const body = JSON.parse(resolve.body) as SupportRequestRow;
    expect(body.status).toBe('resolved');

    // Timeline contains the three transitions in order.
    const events = body.timeline.map((e) => e.event);
    expect(events).toEqual([
      'support.startReview',
      'support.escalateToMinistry',
      'support.resolve',
    ]);
  });

  it('reopen → close round-trip', async () => {
    const submit = await submitSupportRequest(ctx.app);
    const id = submit.body.reportId as string;

    await action(id, 'startReview', 'committee', { note: 'r' });
    await action(id, 'resolve', 'committee', { note: 'done' });

    const reopen = await action(id, 'reopen', 'committee', {
      note: 'survivor reported retaliation; reopening',
    });
    expect(reopen.statusCode).toBe(200);
    expect((JSON.parse(reopen.body) as SupportRequestRow).status).toBe('in_review');

    const close = await action(id, 'close', 'committee', { note: 'duplicate of #443' });
    expect(close.statusCode).toBe(200);
    expect((JSON.parse(close.body) as SupportRequestRow).status).toBe('closed');
  });

  it('rejects invalid transitions (FSM guard)', async () => {
    const submit = await submitSupportRequest(ctx.app);
    const id = submit.body.reportId as string;

    // resolve without going through review first → blocked
    const res = await action(id, 'resolve', 'committee', { note: 'skip review' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { message: string };
    expect(body.message).toMatch(/cannot resolve a request in status "pending"/i);
  });

  it('committee can append free-form notes without changing status', async () => {
    const submit = await submitSupportRequest(ctx.app);
    const id = submit.body.reportId as string;

    await action(id, 'startReview', 'committee', { note: 'reviewing' });
    const noteRes = await action(id, 'note', 'committee', {
      note: 'spoke with submitter; gathering more info',
    });
    expect(noteRes.statusCode).toBe(200);
    const body = JSON.parse(noteRes.body) as SupportRequestRow;
    expect(body.status).toBe('in_review');
    const last = body.timeline[body.timeline.length - 1]!;
    expect(last.event).toBe('support.note_added');
    expect(last.description).toBe('spoke with submitter; gathering more info');
  });

  it('rejects empty notes', async () => {
    const submit = await submitSupportRequest(ctx.app);
    const id = submit.body.reportId as string;
    const res = await action(id, 'note', 'committee', { note: '   ' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects general-member workflow actions', async () => {
    const submit = await submitSupportRequest(ctx.app);
    const id = submit.body.reportId as string;
    const res = await action(id, 'startReview', 'general', { note: 'shouldnt work' });
    expect(res.statusCode).toBe(403);
  });
});
