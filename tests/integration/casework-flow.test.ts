/**
 * Casework (MIS) resource integration tests.
 *
 * Pins the contract the member workspace + admin dashboard depend on:
 *   1. Any signed-in member can register a survivor; `recordedBy` is stamped
 *      server-side (not from the client) and a friendly `ANB-SUR-…` handle
 *      is generated.
 *   2. Ownership scoping — a member sees only survivors they recorded; a
 *      DIFFERENT member does not see them; staff (admin) see all.
 *   3. A survivor-case links to its survivor by `survivorId` and gets an
 *      `ANB-CASE-…` handle; `type` discriminates the form.
 *   4. The service-provider directory is staff-curated: members read, only
 *      staff write.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import type { FastifyInstance } from 'fastify';
import { useIntegrationApp, type IntegrationCtx } from '../helpers/lifecycle.js';

interface SurvivorRow {
  _id: string;
  survivorId: string;
  name: string;
  recordedBy?: string;
  recordedByName?: string;
}

interface ListEnvelope<T> {
  method: string;
  data: T[];
}

/** Spin up a second, independent `general` member to prove cross-member
 *  isolation (the seeded helper only creates one of each role). */
async function seedExtraGeneral(
  app: FastifyInstance,
  email: string,
): Promise<{ userId: string; token: string }> {
  const signup = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'integration-pass-1234', name: 'general2' },
  });
  const userId = JSON.parse(signup.body).user.id as string;
  const userOid = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : null;
  await mongoose.connection.db!.collection('user').updateOne(
    userOid ? { _id: userOid } : { _id: userId as never },
    { $set: { role: 'general', updatedAt: new Date() } },
  );
  const signin = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    payload: { email, password: 'integration-pass-1234' },
  });
  return { userId, token: signin.headers['set-auth-token'] as string };
}

describe('casework (MIS) resources', () => {
  let ctx: IntegrationCtx;

  beforeAll(async () => {
    ctx = await useIntegrationApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  let survivorId = '';

  it('a general member can register a survivor; recordedBy is stamped, handle generated', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/survivors',
      headers: ctx.auth.as('general').headers,
      // Try to spoof recordedBy — it must be ignored (systemManaged).
      payload: { name: 'Survivor One', mobile: '01700000000', recordedBy: 'spoofed-id' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as SurvivorRow;
    expect(body.survivorId).toMatch(/^ANB-SUR-/);
    expect(body.recordedBy).toBe(ctx.users.general.userId);
    expect(body.recordedBy).not.toBe('spoofed-id');
    survivorId = body.survivorId;
  });

  it('the recording member sees their survivor in the list', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/survivors',
      headers: ctx.auth.as('general').headers,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as ListEnvelope<SurvivorRow>;
    expect(body.data.some((s) => s.survivorId === survivorId)).toBe(true);
  });

  it('admin (staff) sees all survivors', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/survivors',
      headers: ctx.auth.as('admin').headers,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as ListEnvelope<SurvivorRow>;
    expect(body.data.some((s) => s.survivorId === survivorId)).toBe(true);
  });

  it('a DIFFERENT member cannot see another member\'s survivor (ownership scoping)', async () => {
    const gen2 = await seedExtraGeneral(ctx.app, 'general2@anirban.test');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/survivors',
      headers: { Authorization: `Bearer ${gen2.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as ListEnvelope<SurvivorRow>;
    expect(body.data.some((s) => s.survivorId === survivorId)).toBe(false);
  });

  it('a member can log a case against their survivor', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/survivor-cases',
      headers: ctx.auth.as('general').headers,
      payload: {
        survivorId,
        type: 'counseling',
        counselorName: 'Dr. Rahman',
        sessionCount: 2,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { caseId: string; type: string; recordedBy?: string };
    expect(body.caseId).toMatch(/^ANB-CASE-/);
    expect(body.type).toBe('counseling');
    expect(body.recordedBy).toBe(ctx.users.general.userId);
  });

  it('the service-provider directory is staff-write, member-read', async () => {
    // Member CANNOT create a provider.
    const memberWrite = await ctx.app.inject({
      method: 'POST',
      url: '/api/service-providers',
      headers: ctx.auth.as('general').headers,
      payload: { name: 'Should Fail Clinic' },
    });
    expect(memberWrite.statusCode).toBe(403);

    // Admin CAN.
    const adminWrite = await ctx.app.inject({
      method: 'POST',
      url: '/api/service-providers',
      headers: ctx.auth.as('admin').headers,
      payload: { name: 'Dhaka Counseling Center', categories: ['counseling'] },
    });
    expect(adminWrite.statusCode).toBe(201);

    // Member CAN read the directory (to pick from it on the case form).
    const memberRead = await ctx.app.inject({
      method: 'GET',
      url: '/api/service-providers',
      headers: ctx.auth.as('general').headers,
    });
    expect(memberRead.statusCode).toBe(200);
    const body = JSON.parse(memberRead.body) as ListEnvelope<{ name: string }>;
    expect(body.data.some((p) => p.name === 'Dhaka Counseling Center')).toBe(true);
  });
});
