/**
 * Integration test lifecycle — single arc + BA + Mongo app per file.
 *
 * Wires:
 *   1. `mongo-memory-server` for an isolated DB per file
 *   2. `mongoose.connect(dbUri)` before importing any model module
 *   3. arc app via `createApp` with the project's full resource registry
 *   4. Pre-seeded BA users — `admin`, `committee`, `general` — each with
 *      `user.role` set to the matching foundation role. arc's auth
 *      adapter copies `user.role` into `request.scope.userRoles`, so
 *      `requireRoles(['admin'])` clears without an org-membership lookup.
 *
 * No foundation-org seeding here: we dropped Better Auth's `organization`
 * plugin in production (see `auth.config.ts`), so there is no org row to
 * create at boot.
 *
 * Returns a context with:
 *   - `app`         the Fastify instance (use `app.inject(...)`)
 *   - `auth`        TestAuthProvider with bearer headers per role
 *   - `users`       map of seeded users (token, userId, role)
 *   - `dbUri`       the in-memory Mongo URI
 *   - `close()`     idempotent teardown
 */

import type { FastifyInstance } from 'fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

export type FoundationRole = 'admin' | 'committee_member' | 'general';
export type UserKey = 'admin' | 'committee' | 'general';

export interface IntegrationCtx {
  app: FastifyInstance;
  auth: {
    as: (role: UserKey) => { headers: Record<string, string> };
  };
  users: Record<UserKey, { userId: string; token: string; email: string }>;
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
  // The media resource boots its engine at module-load (top-level await)
  // and throws if any cloud key is missing. We never hit Cloudinary in
  // tests, but the boot still needs strings — wire dummies once.
  process.env.CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'test-cloud';
  process.env.CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || 'test-key';
  process.env.CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || 'test-secret';

  await mongoose.connect(dbUri);

  // Re-import after `mongoose.connect` so the BA client sees the live
  // connection. Auth is a module-level singleton in production code, so
  // this also resets it between test files.
  const { STATIC_RESOURCES } = await import('#resources/index.js');
  const { createAppInstance } = await import('../../src/app.js');

  // Pass STATIC_RESOURCES so arc skips `loadResources` discovery — vitest's
  // tsx loader can't follow nested `.js`→`.ts` resolution through dynamic
  // imports, which would break every resource load.
  const app = await createAppInstance({ resources: STATIC_RESOURCES });
  await app.ready();

  const users = await seedUsers(app);

  // Bearer-token-only auth. The BE no longer reads `x-organization-id`
  // (org plugin gone), so we don't pin one here.
  const auth = {
    as: (role: UserKey) => ({
      headers: { Authorization: `Bearer ${users[role].token}` },
    }),
  };

  return {
    app,
    auth,
    users,
    dbUri,
    async close() {
      await app.close();
      await mongoose.disconnect();
      await mongo.stop();
    },
  };
}

const ROLE_BY_KEY: Record<UserKey, FoundationRole> = {
  admin: 'admin',
  committee: 'committee_member',
  general: 'general',
};

async function seedUsers(app: FastifyInstance): Promise<IntegrationCtx['users']> {
  const seeds: ReadonlyArray<{ key: UserKey; email: string }> = [
    { key: 'admin', email: 'admin@anirban.test' },
    { key: 'committee', email: 'committee@anirban.test' },
    { key: 'general', email: 'general@anirban.test' },
  ];

  const out: IntegrationCtx['users'] = {} as IntegrationCtx['users'];

  for (const seed of seeds) {
    // Sign up the user (BA emailAndPassword).
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

    // Pin the foundation role directly on the BA `user` doc. The admin
    // plugin's `setRole` requires an admin caller — chicken-and-egg at
    // test boot. Direct write matches what bootstrap.ts does in prod.
    const userId = JSON.parse(signup.body).user.id as string;
    const userOid = mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : null;
    await mongoose.connection.db!.collection('user').updateOne(
      userOid ? { _id: userOid } : { _id: userId as never },
      { $set: { role: ROLE_BY_KEY[seed.key], updatedAt: new Date() } },
    );

    // Sign in AFTER the role pin so the session token carries the fresh
    // role on the next `getSession` (BA's session resolves `user` by
    // userId on each call, so the role is read live anyway — but signing
    // in fresh keeps the contract obvious).
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

    out[seed.key] = { userId, token, email: seed.email };
  }

  return out;
}
