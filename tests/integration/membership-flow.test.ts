/**
 * Membership-request scenario — full survivor onboarding flow.
 *
 * The actual member onboarding (BA invitation email + accept link) lives
 * 100% in better-auth's `organization` plugin. The FE drives that via
 * `authClient.organization.inviteMember(...)` after PATCHing this resource.
 * Server-side we just track the application state.
 *
 * 1. **Public** submits an application → 201, `pending`
 * 2. **General** member can NOT list/manage applications → 403
 * 3. **Admin** lists pending applications, sees the new one
 * 4. **Admin** approves via PATCH `{ status: 'approved' }` (FE then calls
 *    `authClient.organization.inviteMember` separately)
 * 5. **Admin** rejects via PATCH `{ status: 'rejected', rejectionReason }`
 * 6. **Duplicate pending application** for the same email is blocked
 *
 * What this pins:
 *   - public-only `create` permission, admin-only management surface
 *   - PATCH carries the approval/rejection state cleanly
 *   - the partial-unique index prevents duplicate `pending` applications
 *   - `survivorStory`, `imageUrl`, `phone` round-trip on the wire
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useIntegrationApp, type IntegrationCtx } from '../helpers/lifecycle.js';
import { submitMembershipRequest } from '../helpers/fixtures.js';

interface MembershipRequestRow {
  _id: string;
  applicantName: string;
  email: string;
  phone?: string;
  imageUrl?: string;
  survivorStory: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
}

describe('membership-request flow', () => {
  let ctx: IntegrationCtx;

  beforeAll(async () => {
    ctx = await useIntegrationApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('allows the public to submit an application (no auth)', async () => {
    const { statusCode, body } = await submitMembershipRequest(ctx.app, {
      applicantName: 'Aysha Begum',
      email: 'aysha@example.com',
      phone: '+8801XXXXXXXXX',
      imageUrl: 'https://cdn.anirban.org/photos/aysha.jpg',
      survivorStory: 'I returned home in 2024 and want to help.',
    });
    expect(statusCode).toBe(201);
    expect(body).toMatchObject({
      applicantName: 'Aysha Begum',
      email: 'aysha@example.com',
      phone: '+8801XXXXXXXXX',
      imageUrl: 'https://cdn.anirban.org/photos/aysha.jpg',
      status: 'pending',
    });
    expect(body._id).toBeTypeOf('string');
  });

  it('rejects unauthenticated list reads', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/membership-requests' });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('rejects general-member list reads (admin-only surface)', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/membership-requests',
      headers: ctx.auth.as('general').headers,
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin can list applications (paginated wire shape)', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/membership-requests',
      headers: ctx.auth.as('admin').headers,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      method: string;
      data: MembershipRequestRow[];
    };
    expect(body.method).toBe('offset');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('admin can filter by status=pending', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/membership-requests?status=pending',
      headers: ctx.auth.as('admin').headers,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: MembershipRequestRow[] };
    expect(body.data.every((r) => r.status === 'pending')).toBe(true);
  });

  it('admin approves via PATCH (FE then calls authClient.organization.inviteMember)', async () => {
    const submit = await submitMembershipRequest(ctx.app, {
      email: 'approve-target@example.com',
      applicantName: 'Approve Target',
    });
    expect(submit.statusCode).toBe(201);
    const id = submit.body._id as string;

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/membership-requests/${id}`,
      headers: ctx.auth.as('admin').headers,
      payload: { status: 'approved' },
    });
    expect(patch.statusCode).toBe(200);
    const body = JSON.parse(patch.body) as MembershipRequestRow;
    expect(body.status).toBe('approved');
    expect(body.email).toBe('approve-target@example.com');
  });

  it('admin rejects via PATCH with reason', async () => {
    const submit = await submitMembershipRequest(ctx.app, {
      email: 'rejected@example.com',
    });
    const id = submit.body._id as string;

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/membership-requests/${id}`,
      headers: ctx.auth.as('admin').headers,
      payload: {
        status: 'rejected',
        rejectionReason: 'Insufficient documentation provided',
      },
    });
    expect(patch.statusCode).toBe(200);
    const body = JSON.parse(patch.body) as MembershipRequestRow;
    expect(body.status).toBe('rejected');
    expect(body.rejectionReason).toBe('Insufficient documentation provided');
  });

  it('rejects general-member PATCH attempts (admin-only)', async () => {
    const submit = await submitMembershipRequest(ctx.app, {
      email: 'general-cannot-patch@example.com',
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

  it('blocks duplicate pending applications for the same email', async () => {
    const a = await submitMembershipRequest(ctx.app, { email: 'dup@example.com' });
    expect(a.statusCode).toBe(201);
    const b = await submitMembershipRequest(ctx.app, { email: 'dup@example.com' });
    // Mongo unique-partial-index error or arc 409 — either is acceptable
    // as long as the second submission is blocked.
    expect([400, 409, 500]).toContain(b.statusCode);
  });

  it('a rejected applicant CAN re-apply (unique index is partial on status=pending)', async () => {
    const submit = await submitMembershipRequest(ctx.app, { email: 'reapply@example.com' });
    const id = submit.body._id as string;

    // Reject the first one.
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/membership-requests/${id}`,
      headers: ctx.auth.as('admin').headers,
      payload: { status: 'rejected', rejectionReason: 'first attempt — needs more info' },
    });

    // Re-apply.
    const second = await submitMembershipRequest(ctx.app, {
      email: 'reapply@example.com',
      survivorStory: 'Adding more context as requested.',
    });
    expect(second.statusCode).toBe(201);
    expect(second.body.status).toBe('pending');
  });
});
