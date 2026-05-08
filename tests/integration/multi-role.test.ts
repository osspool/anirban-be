/**
 * Multi-role scenario.
 *
 * BA's admin plugin stores `user.role` as a single string. arc's auth
 * adapter (`normalizeRoles` in `@classytic/arc/auth`) splits the value
 * on commas, so writing `'admin,committee_member'` to `user.role` makes
 * arc see BOTH roles in `request.scope.userRoles`. `requireRoles(...)`
 * passes if any expected role is in the union.
 *
 * Net effect: a foundation member can hold multiple roles at once — an
 * "executive" who is both committee member and admin gets both
 * permission sets without role inheritance plumbing.
 *
 * What this pins:
 *   - `'admin,committee_member'` on `user.role` is accepted by arc —
 *     the user can hit admin-gated endpoints (membership PATCH) AND
 *     committee-gated endpoints (support workflow) with the same token.
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

describe('multi-role user (executive holding admin + committee_member)', () => {
  let ctx: IntegrationCtx;
  let executiveToken: string;

  beforeAll(async () => {
    ctx = await useIntegrationApp();

    // Promote the seeded `committee` user to ALSO carry `admin`. We write
    // the comma-separated value directly to `user.role` — that's what the
    // BA admin plugin reads, and arc's auth adapter splits it.
    const userId = ctx.users.committee.userId;
    const userOid = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : null;
    await mongoose.connection.db!.collection('user').updateOne(
      userOid ? { _id: userOid } : { _id: userId as never },
      { $set: { role: 'admin,committee_member' } },
    );

    // Re-sign-in so the new session reads the updated role.
    const signin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: ctx.users.committee.email, password: 'integration-pass-1234' },
    });
    executiveToken = signin.headers['set-auth-token'] as string;
  });

  afterAll(async () => {
    await ctx?.close();
  });

  function execHeaders() {
    return { Authorization: `Bearer ${executiveToken}` };
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
    const id = submit.body.reportId as string;

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
