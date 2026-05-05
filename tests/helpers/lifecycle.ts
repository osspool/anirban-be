/**
 * Integration test lifecycle — single arc + BA + Mongo app per file.
 *
 * Wires:
 *   1. `mongo-memory-server` for an isolated DB per file
 *   2. `mongoose.connect(dbUri)` before importing any model module
 *   3. The single foundation org (matching production bootstrap.ts)
 *   4. arc app via `createApp` with the project's full resource registry
 *   5. Pre-seeded BA users: `creator` (foundation admin) + `committee` + `general`
 *
 * Returns a context with:
 *   - `app`         the Fastify instance (use `app.inject(...)`)
 *   - `auth`        TestAuthProvider with bearer headers per role
 *   - `users`       map of seeded users (token, userId, role)
 *   - `orgId`       the foundation org id
 *   - `dbUri`       the in-memory Mongo URI
 *   - `close()`     idempotent teardown
 *
 * Usage:
 *   const ctx = await useIntegrationApp();
 *   afterAll(() => ctx.close());
 *   const res = await ctx.app.inject({
 *     method: 'GET',
 *     url: '/api/membership-requests',
 *     headers: ctx.auth.as('admin').headers,
 *   });
 */

import type { FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

export interface IntegrationCtx {
  app: FastifyInstance;
  auth: {
    as: (role: 'admin' | 'committee' | 'general') => { headers: Record<string, string> };
  };
  users: Record<
    'admin' | 'committee' | 'general',
    { userId: string; token: string; email: string }
  >;
  orgId: string;
  dbUri: string;
  close(): Promise<void>;
}

export async function useIntegrationApp(): Promise<IntegrationCtx> {
  const mongo = await MongoMemoryServer.create();
  const dbUri = mongo.getUri();
  process.env.MONGODB_URI = dbUri;
  process.env.BETTER_AUTH_SECRET =
    process.env.BETTER_AUTH_SECRET || 'integration-test-secret-min-32-chars-long-x';
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
  process.env.PORT = process.env.PORT || '0';

  await mongoose.connect(dbUri);

  // Reset module state between test files — auth is a singleton in
  // production code, so a stale instance would point at a torn-down DB.
  // We re-import everything *after* mongoose.connect so the BA client
  // sees the live connection.
  const { ensureFoundationOrg } = await import('#resources/auth/bootstrap.js');
  const { STATIC_RESOURCES } = await import('#resources/index.js');
  const { createAppInstance } = await import('../../src/app.js');

  const orgId = await ensureFoundationOrg();
  // Pass STATIC_RESOURCES so arc skips `loadResources` discovery —
  // vitest's tsx loader can't follow nested `.js`→`.ts` resolution
  // through dynamic imports, which would break every resource load.
  const app = await createAppInstance({ resources: STATIC_RESOURCES });
  await app.ready();

  // Seed three users — admin (foundation creator), committee_member, general.
  const users = await seedUsers(app, orgId);

  // arc's BA adapter resolves `req.scope.orgRoles` from EITHER the BA
  // session's `activeOrganizationId` OR an explicit `x-organization-id`
  // header. The header path is what real frontends use (cookieless,
  // stateless), so we pin it here — keeps the test contract close to
  // production usage.
  const auth = {
    as: (role: 'admin' | 'committee' | 'general') => ({
      headers: {
        Authorization: `Bearer ${users[role].token}`,
        'x-organization-id': orgId,
      },
    }),
  };

  return {
    app,
    auth,
    users,
    orgId,
    dbUri,
    async close() {
      await app.close();
      await mongoose.disconnect();
      await mongo.stop();
    },
  };
}

async function seedUsers(
  app: FastifyInstance,
  orgId: string,
): Promise<IntegrationCtx['users']> {
  const seeds = [
    { key: 'admin', email: 'admin@anirban.test', orgRole: 'admin' },
    { key: 'committee', email: 'committee@anirban.test', orgRole: 'committee_member' },
    { key: 'general', email: 'general@anirban.test', orgRole: 'general' },
  ] as const;

  const out: IntegrationCtx['users'] = {} as IntegrationCtx['users'];

  for (const seed of seeds) {
    // Sign up the user (BA emailAndPassword.autoSignIn would be nicer
    // but isn't on by default in the prod config; we pull the token
    // from a follow-up sign-in instead).
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email: seed.email, password: 'integration-pass-1234', name: seed.key },
    });
    if (signup.statusCode >= 400) {
      throw new Error(
        `signup failed for ${seed.email}: ${signup.statusCode} ${signup.body.slice(0, 200)}`,
      );
    }

    // Sign in to get a fresh bearer token (independent of cookies).
    const signin = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: seed.email, password: 'integration-pass-1234' },
    });
    if (signin.statusCode >= 400) {
      throw new Error(
        `signin failed for ${seed.email}: ${signin.statusCode} ${signin.body.slice(0, 200)}`,
      );
    }
    const token = signin.headers['set-auth-token'] as string | undefined;
    if (!token) {
      throw new Error(`no set-auth-token returned for ${seed.email}`);
    }
    const body = JSON.parse(signin.body) as { user: { id: string } };

    // Add the user to the foundation org with the right role. We bypass
    // BA's invite flow at seed time (that's an end-user UX, not a test
    // setup detail) and write directly to the `member` collection. BA's
    // mongo-adapter stores user/org refs as ObjectIds — using strings
    // here means `auth.api.listOrganizations` won't see the row.
    await mongoose.connection.db!.collection('member').insertOne({
      _id: new mongoose.Types.ObjectId(),
      organizationId: new mongoose.Types.ObjectId(orgId),
      userId: new mongoose.Types.ObjectId(body.user.id),
      role: seed.orgRole,
      createdAt: new Date(),
    });

    // Set the active organization on this session so arc can resolve
    // `req.scope.orgRoles` via BA's `getActiveMember` API. Without
    // this, the bearer-token request would arrive at arc with no
    // active-org context (cookies are off), and `requireRoles` would
    // reject as 403 even when the membership row exists.
    const setActive = await app.inject({
      method: 'POST',
      url: '/api/auth/organization/set-active',
      headers: { Authorization: `Bearer ${token}` },
      payload: { organizationId: orgId },
    });
    if (setActive.statusCode >= 400) {
      throw new Error(
        `set-active failed for ${seed.email}: ${setActive.statusCode} ${setActive.body.slice(0, 200)}`,
      );
    }

    out[seed.key] = { userId: body.user.id, token, email: seed.email };
  }

  return out;
}
