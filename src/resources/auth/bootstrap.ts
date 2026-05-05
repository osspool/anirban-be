/**
 * Bootstrap — seeds the single foundation org + first superadmin user.
 *
 * Single-tenant deployment: the foundation org is created on first boot
 * and reused forever. The frontend reads its id via
 * `authClient.organization.list()` after sign-in, so the server doesn't
 * need to cache it — every BA org-scoped call from the FE carries the
 * id explicitly.
 *
 * Idempotent — safe to call on every boot. Slug `anirban` doubles as the
 * uniqueness key.
 *
 * Initial-superadmin seeding follows the standard pattern: pull
 * `ANIRBAN_BOOTSTRAP_ADMIN_EMAIL` + `ANIRBAN_BOOTSTRAP_ADMIN_PASSWORD`,
 * create the user via `auth.api.signUpEmail` if missing, then promote
 * via the admin plugin's `setRole`. Skip silently when env vars are
 * unset (e.g. test environments that seed their own users).
 */

import mongoose from 'mongoose';
import { getAuth } from './auth.config.js';

const FOUNDATION_NAME = 'Anirban Survivor Voice Foundation';
const FOUNDATION_SLUG = 'anirban';

interface OrgListEntry {
  id: string;
  slug: string;
  name?: string;
}

export async function ensureFoundationOrg(): Promise<string> {
  const auth = getAuth();
  const api = auth.api as Record<string, unknown>;

  // 0. Enforce membership uniqueness at the DB layer — BA's mongo-adapter
  //    has historically written `userId` / `organizationId` as either
  //    String or ObjectId depending on the plugin path, and dedupe checks
  //    in user-land miss the type-mismatch. The unique compound index
  //    catches a stray double-insert before it can split a user across
  //    rows, AND collapses duplicates discovered below.
  await ensureMemberUniqueIndex();
  await collapseDuplicateMembers();

  // 1. Look for an existing foundation org. BA's `listOrganizations`
  //    returns every org the resolver can see — for our single-org
  //    deployment that's at most one row.
  const orgs = await readOrgsFromDb();
  const existing = orgs.find((o) => o.slug === FOUNDATION_SLUG);
  if (existing) {
    return existing.id;
  }

  // 2. Create. We bypass `auth.api.createOrganization` because that
  //    requires a session; at boot there's no caller. Direct mongoose
  //    insert into BA's `organization` collection is the documented
  //    bootstrap pattern (BA's org plugin doesn't ship a system-API).
  const _id = new mongoose.Types.ObjectId();
  const now = new Date();
  await mongoose.connection.db!.collection('organization').insertOne({
    _id,
    name: FOUNDATION_NAME,
    slug: FOUNDATION_SLUG,
    createdAt: now,
    updatedAt: now,
  });

  const orgId = _id.toString();
  // biome-ignore lint/suspicious/noConsole: bootstrap log is intentional
  console.log(`[bootstrap] foundation org seeded: ${FOUNDATION_NAME} (${orgId})`);
  void api; // silence unused while we don't yet hit BA APIs here
  return orgId;
}

/**
 * Ensure `(organizationId, userId)` is unique across the BA `member`
 * collection. Idempotent — `createIndex` is a no-op when the index already
 * exists with the same shape. Run before the duplicate sweep so a future
 * insert from the BA adapter can't recreate the same conflict.
 */
async function ensureMemberUniqueIndex(): Promise<void> {
  try {
    await mongoose.connection
      .db!.collection('member')
      .createIndex({ organizationId: 1, userId: 1 }, { unique: true, name: 'uniq_org_user' });
  } catch (err) {
    // If the index can't be built because duplicates exist, fall through —
    // `collapseDuplicateMembers` will clean them up and the next boot
    // creates the index successfully. This single-retry pattern keeps
    // existing dev DBs upgradeable without manual fixup.
    // biome-ignore lint/suspicious/noConsole: bootstrap log
    console.warn(
      '[bootstrap] member unique index deferred — duplicates pending cleanup:',
      (err as Error).message,
    );
  }
}

/**
 * Collapse duplicate `(organizationId, userId)` member rows.
 *
 * Why duplicates happen: BA's mongo-adapter has been written `userId` /
 * `organizationId` as plain strings in older rows but ObjectIds in newer
 * ones. A `findOne({ userId: ObjectId(...) })` check then misses the
 * legacy row and inserts a fresh one. Compare by string-cast value so we
 * catch both shapes.
 *
 * Keep the row with the broadest type-coverage — prefer ObjectId refs
 * since BA's current adapter and our overlay both query in that shape.
 */
async function collapseDuplicateMembers(): Promise<void> {
  const col = mongoose.connection.db!.collection('member');
  const all = await col.find({}).toArray();
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous BSON shapes
  const byKey = new Map<string, any[]>();
  for (const row of all) {
    const key = `${String(row.organizationId)}::${String(row.userId)}`;
    const arr = byKey.get(key) ?? [];
    arr.push(row);
    byKey.set(key, arr);
  }
  let removed = 0;
  for (const [, rows] of byKey) {
    if (rows.length < 2) continue;
    // Prefer the ObjectId-typed row; fall back to most recent.
    rows.sort((a, b) => {
      const aObj = a.userId?.constructor?.name === 'ObjectId' ? 1 : 0;
      const bObj = b.userId?.constructor?.name === 'ObjectId' ? 1 : 0;
      if (aObj !== bObj) return bObj - aObj;
      return (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0);
    });
    const [keep, ...drop] = rows;
    await col.deleteMany({ _id: { $in: drop.map((d) => d._id) } });
    removed += drop.length;
    void keep;
  }
  if (removed > 0) {
    // biome-ignore lint/suspicious/noConsole: bootstrap log
    console.log(`[bootstrap] collapsed ${removed} duplicate member row(s)`);
    // Retry the unique index now that duplicates are gone.
    try {
      await col.createIndex(
        { organizationId: 1, userId: 1 },
        { unique: true, name: 'uniq_org_user' },
      );
    } catch {
      // Already exists from the first attempt — fine.
    }
  }
}

async function readOrgsFromDb(): Promise<OrgListEntry[]> {
  const docs = await mongoose.connection
    .db!.collection<{ _id: unknown; slug: string; name?: string }>('organization')
    .find({}, { projection: { slug: 1, name: 1 } })
    .toArray();
  return docs.map((d) => ({ id: String(d._id), slug: d.slug, name: d.name }));
}

/**
 * Seed an initial superadmin if `ANIRBAN_BOOTSTRAP_ADMIN_EMAIL` is set.
 * Idempotent: skips when the user already exists.
 *
 * Adds the user as a foundation `admin` (org-scoped role) AND promotes
 * them to BA's `superadmin` (platform role) so they can manage the
 * platform — bans, impersonation, future cross-org expansion.
 */
export async function ensureBootstrapAdmin(orgId: string): Promise<void> {
  const email = process.env.ANIRBAN_BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.ANIRBAN_BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;

  const auth = getAuth();
  const api = auth.api as Record<string, unknown>;

  // Look up existing user.
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
    console.log(`[bootstrap] superadmin user created: ${email}`);
  }

  // Promote to platform superadmin.
  const setPlatformRole = api.setRole as
    | ((opts: { body: { userId: string; role: string } }) => Promise<unknown>)
    | undefined;
  if (typeof setPlatformRole === 'function') {
    await setPlatformRole({ body: { userId, role: 'admin' } }).catch(() => undefined);
  }

  // Add to foundation org as admin (idempotent). BA's mongo-adapter
  // stores `userId` and `organizationId` as ObjectIds — use ObjectId
  // refs on both sides so `auth.api.listOrganizations` / `set-active`
  // join correctly.
  const memberCol = mongoose.connection.db!.collection('member');
  const orgObjectId = new mongoose.Types.ObjectId(orgId);
  const userObjectId = new mongoose.Types.ObjectId(userId);
  // Match either ObjectId or legacy String form — BA's adapter has used
  // both shapes across versions, and missing one would cause us to
  // duplicate the membership row (caught further by the unique index in
  // `ensureFoundationOrg`, but cheaper to short-circuit here).
  const already = await memberCol.findOne({
    $and: [
      { $or: [{ userId: userObjectId }, { userId }] },
      { $or: [{ organizationId: orgObjectId }, { organizationId: orgId }] },
    ],
  });
  if (!already) {
    await memberCol.insertOne({
      _id: new mongoose.Types.ObjectId(),
      organizationId: orgObjectId,
      userId: userObjectId,
      role: 'admin',
      createdAt: new Date(),
    });
    // biome-ignore lint/suspicious/noConsole: bootstrap log
    console.log(`[bootstrap] superadmin added to foundation as admin`);
  }
}
