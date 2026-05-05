/**
 * Multi-role scenario.
 *
 * BA's `organization` plugin stores `member.role` as a comma-separated
 * string (e.g. `'admin,committee_member'`) and BA's permission check
 * splits on comma. arc's `extractRolesFromMembership` reads the same
 * field and `requireRoles` matches against any role in the union.
 *
 * Net effect: a foundation member can hold multiple roles at once — an
 * "executive" who is both a committee member and an admin gets both
 * permission sets without role inheritance plumbing.
 *
 * What this pins:
 *   - `'admin,committee_member'` written to `member.role` is accepted by
 *     arc — the user can hit admin-gated endpoints (membership PATCH)
 *     AND committee-gated endpoints (support workflow) with the same
 *     bearer token.
 *   - The role union doesn't bleed: a `general`-only user still 403s on
 *     admin endpoints.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { useIntegrationApp, type IntegrationCtx } from '../helpers/lifecycle.js';
import {
  submitMembershipRequest,
  submitSupportRequest,
} from '../helpers/fixtures.js';

describe('multi-role membership (executive holding admin + committee_member)', () => {
  let ctx: IntegrationCtx;
  let executiveToken: string;

  beforeAll(async () => {
    ctx = await useIntegrationApp();

    // Promote the seeded `committee` user to ALSO carry `admin`. BA stores
    // multi-role as comma-separated; that's what we write here.
    await mongoose.connection.db!.collection('member').updateOne(
      { userId: new mongoose.Types.ObjectId(ctx.users.committee.userId) },
      { $set: { role: 'admin,committee_member' } },
    );
    executiveToken = ctx.users.committee.token;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  function execHeaders() {
    return {
      Authorization: `Bearer ${executiveToken}`,
      'x-organization-id': ctx.orgId,
    };
  }

  it('executive can hit admin-gated membership PATCH', async () => {
    const submit = await submitMembershipRequest(ctx.app, {
      email: 'executive-touch@example.com',
    });
    const id = submit.body._id as string;

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/membership-requests/${id}`,
      headers: execHeaders(),
      payload: { status: 'approved' },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).status).toBe('approved');
  });

  it('executive can also drive support-request workflow', async () => {
    const submit = await submitSupportRequest(ctx.app);
    const id = submit.body._id as string;

    const review = await ctx.app.inject({
      method: 'POST',
      url: `/api/support-requests/${id}/action`,
      headers: execHeaders(),
      payload: { action: 'startReview', note: 'exec triage' },
    });
    expect(review.statusCode).toBe(200);
    expect(JSON.parse(review.body).status).toBe('in_review');
  });

  it('general-only user still 403s on admin-gated endpoint', async () => {
    const submit = await submitMembershipRequest(ctx.app, {
      email: 'general-cant-touch@example.com',
    });
    const id = submit.body._id as string;

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/membership-requests/${id}`,
      headers: ctx.auth.as('general').headers,
      payload: { status: 'approved' },
    });
    expect(res.statusCode).toBe(403);
  });
});
