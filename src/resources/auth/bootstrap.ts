/**
 * Bootstrap — seeds the initial superadmin user + housekeeps schema drift.
 *
 * Single-tenant simplification: no foundation org row anymore (BA's
 * `organization` plugin is gone — see `auth.config.ts`). The directory
 * lives in the plain `Member` arc resource; the bootstrap admin is just
 * a BA `user` with `role: 'superadmin'`.
 *
 * Idempotent — safe to call on every boot. Skip silently when env vars
 * are unset (e.g. test environments that seed their own users).
 */

import mongoose from 'mongoose';
import { getAuth } from './auth.config.js';

/**
 * Drop legacy indexes whose `partialFilterExpression` shape changed
 * (mongoose only creates new indexes — it never updates existing ones,
 * and silently leaves the old spec live, so the schema-side change
 * doesn't take effect). On the next collection access mongoose will
 * recreate the index from the current schema spec.
 *
 * Specifically:
 *   - `membershiprequests.email_1_status_1`
 *     OLD: partialFilter `{ status: 'pending' }`
 *     NEW: partialFilter `{ status: 'pending', email: { $type: 'string' } }`
 *     Without dropping the OLD spec, two email-less pending applications
 *     collide on the unique index because `null === null` matches.
 */
async function dropLegacyIndexes(): Promise<void> {
  const col = mongoose.connection.db?.collection('membershiprequests');
  if (!col) return;
  try {
    const indexes = await col.indexes();
    for (const idx of indexes) {
      if (idx.name === 'email_1_status_1') {
        const filter = idx.partialFilterExpression as Record<string, unknown> | undefined;
        const hasNewShape =
          filter &&
          typeof filter.status === 'string' &&
          filter.email !== undefined;
        if (!hasNewShape) {
          await col.dropIndex(idx.name);
          // biome-ignore lint/suspicious/noConsole: bootstrap log
          console.log('[bootstrap] dropped legacy membership-request unique index');
        }
      }
    }
  } catch (err) {
    // Collection may not exist yet on a clean DB — that's fine; mongoose
    // will create the right index on first model access.
    void err;
  }
}

export async function ensureBootstrapAdmin(): Promise<void> {
  await dropLegacyIndexes();

  const email = process.env.ANIRBAN_BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.ANIRBAN_BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;

  const auth = getAuth();
  const api = auth.api as Record<string, unknown>;

  const existing = await mongoose.connection
    .db!.collection<{ _id: unknown; email: string }>('user')
    .findOne({ email });

  let userId: string;
  if (existing) {
    userId = String(existing._id);
  } else {
    const signUp = api.signUpEmail as
      | ((opts: { body: { email: string; password: string; name: string } }) => Promise<{
          user: { id: string };
        }>)
      | undefined;
    if (typeof signUp !== 'function') {
      // biome-ignore lint/suspicious/noConsole: bootstrap-skip is informational
      console.warn('[bootstrap] auth.api.signUpEmail unavailable — skipping admin seed');
      return;
    }
    const res = await signUp({ body: { email, password, name: 'Anirban Admin' } });
    userId = res.user.id;
    // biome-ignore lint/suspicious/noConsole: bootstrap log
    console.log(`[bootstrap] admin user created: ${email}`);
  }

  // Promote to foundation superadmin. We write `user.role = 'superadmin'`
  // directly because `auth.api.setRole` requires an admin caller (chicken-
  // and-egg at boot — there is none). The founder seed gets the infra
  // tier; regular admins are invited from the dashboard and land on
  // `role: 'admin'` (one rung below).
  //
  // Idempotent — re-running this on a user who is already `admin` upgrades
  // them; on a user who is already `superadmin` it's a no-op. Existing
  // operators don't need a manual migration step.
  void api;
  // BA's mongo-adapter has stored `user._id` as either ObjectId OR string
  // across versions, so try both shapes (cheap idempotent updates).
  const userCol = mongoose.connection.db!.collection('user');
  const filters: Array<Record<string, unknown>> = [];
  if (mongoose.Types.ObjectId.isValid(userId)) {
    filters.push({ _id: new mongoose.Types.ObjectId(userId) });
  }
  filters.push({ _id: userId } as never);
  for (const filter of filters) {
    await userCol.updateOne(filter, {
      $set: { role: 'superadmin', updatedAt: new Date() },
    });
  }
  // biome-ignore lint/suspicious/noConsole: bootstrap log
  console.log(`[bootstrap] superadmin role pinned on ${email}`);
}
