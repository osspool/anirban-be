# arc + better-auth + mongokit — backend agent playbook

Stack patterns only. App-level decisions (route names, role names, env-var conventions, brand-specific seed data) belong in `CLAUDE.md` or project memory — not here.

## Stack

- **Fastify 5+** via `@classytic/arc` (`createApp` + `defineResource`)
- **TypeScript strict, ESM-only**, Node 22+
- **MongoDB** via `mongoose` 9+
- **`@classytic/mongokit`** — typed repos, BA overlay, custom-id plugin, soft-delete
- **`@classytic/repo-core`** — `MinimalRepo` / `StandardRepo` contracts
- **`better-auth`** + plugins: `bearer`, `admin`, `organization`
- **`@classytic/notifications`** — multi-channel notifications (SMTP / SMS / Push / Webhook)

---

## 1. App factory — `src/app.ts`

```ts
import type { ResourceLike } from "@classytic/arc/factory";
import { createApp } from "@classytic/arc/factory";
import { createBetterAuthAdapter } from "@classytic/arc/auth";
import { getAuth } from "#resources/auth/auth.config.js";
import { registerPlugins } from "#plugins/index.js";

interface CreateAppInstanceOptions {
  /** Tests pass `STATIC_RESOURCES` (see below); production omits and uses
   *  `resourceDir` filesystem discovery. */
  resources?: ReadonlyArray<ResourceLike>;
}

export async function createAppInstance(options: CreateAppInstanceOptions = {}) {
  const app = await createApp({
    preset: config.env === "production" ? "production" : "development",
    ...(options.resources
      ? { resources: options.resources as ResourceLike[] }
      : { resourceDir: import.meta.url }),
    resourcePrefix: "/api",
    auth: {
      type: "betterAuth",
      // `orgContext: true` makes arc resolve `req.scope.orgRoles` from BA's
      // `member` collection — required when resources call `requireRoles`.
      betterAuth: createBetterAuthAdapter({ auth: getAuth(), orgContext: true }),
    },
    cors: {
      origin: config.cors.origins,
      methods: config.cors.methods,
      allowedHeaders: config.cors.allowedHeaders,
      credentials: config.cors.credentials,
    },
    trustProxy: true,
    arcPlugins: { metrics: config.env === "production" },
  });
  await registerPlugins(app, { config });
  return app;
}
```

### Resource registration: 2 modes

| Mode | When | How |
|---|---|---|
| `resourceDir` discovery | dev + prod | omit `resources`; arc walks `src/resources/**/*.resource.ts` |
| `resources: STATIC_RESOURCES` | tests (vitest) | vitest's tsx loader can't follow nested `.js`→`.ts` resolution through `loadResources`'s dynamic imports — bypass with an explicit array |

```ts
// src/resources/index.ts
export const STATIC_RESOURCES: ReadonlyArray<ResourceDefinition<unknown>> = [
  memberResource,
  membershipRequestResource,
  supportRequestResource,
];
```

```ts
// tests/helpers/lifecycle.ts
const { STATIC_RESOURCES } = await import("#resources/index.js");
const app = await createAppInstance({ resources: STATIC_RESOURCES });
```

---

## 2. Resource scaffold — `src/resources/<name>/`

```
support-request/
  support-request.model.ts        ← mongoose schema + interface
  support-request.repository.ts   ← mongokit Repository (plugins live here)
  support-request.resource.ts     ← arc defineResource (routes + permissions)
```

### Model (`mongoose.Schema`)

```ts
import mongoose, { type HydratedDocument } from "mongoose";
import timelineAuditPlugin from "mongoose-timeline-audit";

export interface ISupportRequest {
  _id: mongoose.Types.ObjectId;
  /** Friendly tracking handle stamped by mongokit's customIdPlugin. */
  reportId: string;
  subject: string;
  status: "pending" | "in_review" | "resolved" | "closed";
  timeline: TimelineEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<ISupportRequest>({
  reportId: { type: String, required: true, unique: true, index: true },
  subject:  { type: String, required: true, trim: true, maxlength: 200 },
  status:   { type: String, enum: [...], default: "pending", index: true },
}, { timestamps: true });

schema.plugin(timelineAuditPlugin, { fieldName: "timeline" });

export default mongoose.models.SupportRequest ?? mongoose.model("SupportRequest", schema);
```

### Repository (mongokit plugins)

```ts
import { Repository, customIdPlugin, dateSequentialId, methodRegistryPlugin, softDeletePlugin } from "@classytic/mongokit";

class SupportRequestRepository extends Repository<ISupportRequest> {
  constructor() {
    super(SupportRequest, [
      methodRegistryPlugin(),
      // Stamps `reportId` like ANB-2026-0001 via an atomic counter
      // (`_mongokit_counters` collection — safe under concurrency).
      customIdPlugin({
        field: "reportId",
        generator: dateSequentialId({
          prefix: "ANB", model: SupportRequest,
          partition: "yearly", padding: 4, separator: "-",
        }),
      }),
      softDeletePlugin(),
    ]);
  }
}
```

### Resource (arc defineResource)

```ts
import { defineResource } from "@classytic/arc";
import { allowPublic, anyOf, requireRoles } from "@classytic/arc/permissions";
import { buildCrudSchemasFromModel, QueryParser } from "@classytic/mongokit";
import { createMongooseAdapter } from "@classytic/mongokit/adapter";

const supportRequestResource = defineResource<ISupportRequest>({
  name: "support-request",
  prefix: "/support-requests",
  adapter: createMongooseAdapter({
    model: SupportRequest,
    repository: supportRequestRepository,
    schemaGenerator: buildCrudSchemasFromModel,
  }),
  queryParser: new QueryParser({
    allowedFilterFields: ["status", "category", "priority"],
  }),
  presets: ["softDelete"],
  tenantField: false,                  // single-tenant: foundation-wide

  // URL `:id` resolves cases by the friendly handle, not the ObjectId.
  // The FE pins `createCrudHooks({ idField: 'reportId' })` to match.
  idField: "reportId",

  permissions: {
    create: allowPublic(),              // public submission
    get:    allowPublic(),              // id IS the tracking token
    list:   anyOf(requireRoles(["admin"]), requireRoles(["committee_member"])),
    update: anyOf(requireRoles(["admin"]), requireRoles(["committee_member"])),
    delete: requireRoles(["admin"]),
  },

  schemaOptions: {
    fieldRules: {
      // The plugin stamps it on create — never accept from a client.
      reportId: { systemManaged: true },
      status:   { systemManaged: true },
      timeline: { systemManaged: true },
    },
  },

  // FSM transitions — every action becomes `POST /:id/action` with body
  // `{ action: "<name>", data?: {...} }`. arc dispatches by `body.action`.
  actions: {
    startReview: {
      permissions: requireRoles(["admin"]),
      handler: async (id, data, req) => {
        // `id` is the value of the URL `:id` segment — `reportId` here, NOT _id.
        const doc = await SupportRequest.findOne({ reportId: id });
        if (!doc) throw new NotFoundError("SupportRequest");
        // ...
      },
    },
  },
});
```

### Resource conventions

- **`idField`** binds URL `:id` to a domain handle. Custom action handlers receive the same handle as their `id` argument — use `findOne({ <idField>: id })`, NOT `findById(id)`.
- **`fieldRules.<key>: { systemManaged: true }`** locks a field against client writes. Use it on every plugin-stamped or transition-only column (`reportId`, `timeline`, `status`).
- **`tenantField: false`** for single-tenant apps (foundation-wide reads). For multi-tenant, set to the orgId field name and arc auto-scopes every query.
- **`actions: { ... }`** is arc's unified FSM router (`POST /:id/action`). Don't ship one route per transition — the FE calls a single endpoint with `{ action }` in the body.

---

## 3. Better Auth integration

```ts
// src/resources/auth/auth.config.ts
import { betterAuth } from "better-auth";
import { admin as adminPlugin, bearer, organization } from "better-auth/plugins";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { registerBetterAuthStubs } from "@classytic/mongokit/better-auth";
import { notify } from "#shared/notifications/notification.service.js";

let _auth: { handler: (req: Request) => Promise<Response>; api: Record<string, unknown> } | null = null;

export function getAuth() {
  if (_auth) return _auth;
  _auth = betterAuth({
    secret: config.betterAuth.secret,
    baseURL: process.env.BETTER_AUTH_URL || `http://localhost:${config.server.port}`,
    basePath: "/api/auth",
    database: mongodbAdapter(mongoose.connection.getClient().db() as never),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url, token }) => {
        const callbackURL = new URL(url).searchParams.get("callbackURL")
          || `${config.frontend.url}/reset-password`;
        await notify("password_reset",
          { email: user.email, name: user.name },
          { userName: user.name || user.email, resetLink: `${callbackURL}?token=${token}` });
      },
    },
    // CRITICAL — mirror CORS allowlist into BA's CSRF/origin check so the two
    // never drift apart. A request that survived CORS shouldn't 403 on BA's
    // `Invalid origin` guard.
    trustedOrigins: Array.isArray(config.cors.origins)
      ? Array.from(new Set([config.frontend.url, ...config.cors.origins]))
      : config.cors.origins === true ? ["*"] : [config.frontend.url],
    plugins: [
      bearer(),
      adminPlugin(),
      organization({
        allowUserToCreateOrganization: false,    // single-tenant
        creatorRole: "admin",
        ac, roles: { admin, committee_member, general },
        schema: {
          // Survivor-profile fields live on the BA `member` collection — keep
          // identity (`user`) portable, layer brand data on `member`.
          member: {
            additionalFields: {
              displayName:  { type: "string",  required: false },
              bio:          { type: "string",  required: false },
              division:     { type: "string",  required: false },
              districtLabel:{ type: "string",  required: false },
              memberStatus: { type: "string",  required: false, defaultValue: "active" },
              isPubliclyListed: { type: "boolean", required: false, defaultValue: true },
            },
          },
        },
        sendInvitationEmail: async (data) => {
          const inviteLink = `${config.frontend.url}/accept-invitation/${data.id}`;
          await notify("organization_invitation",
            { email: data.email, name: data.email },
            { email: data.email, organizationName: data.organization.name,
              role: data.role, inviterName: data.inviter?.user?.name || "Admin",
              inviteLink });
        },
      }),
    ],
  });
  // Stub mongoose models for `.populate('user' | 'organization' | …)` from
  // arc resources — BA uses raw mongo, no models otherwise. Plugin-aware,
  // picks up additionalFields shape.
  registerBetterAuthStubs(mongoose, { plugins: ["organization"] });
  return _auth;
}
```

### `FRONTEND_URL` vs `CORS_ORIGINS` — different jobs

- **`FRONTEND_URL`** = the canonical URL used to build email-link templates (`${frontend.url}/accept-invitation/${id}`, password-reset URL). Emails point at one URL — pick the public-facing one.
- **`CORS_ORIGINS`** = comma-separated list of browsers allowed to call `/api/*`. Feeds BOTH `cors.origin` AND BA's `trustedOrigins` (via the union above).

If FRONTEND_URL doesn't appear in CORS_ORIGINS, login from that origin throws `Invalid origin`.

### Don't poke BA collections via raw mongo

`auth.api.*` server-side has direct functions for everything that mutates BA state — `auth.api.createInvitation`, `auth.api.signUpEmail`, `auth.api.setRole`. Direct `db.collection('member').updateOne(...)` writes bypass BA's hooks (so `sendInvitationEmail` never fires, audit trail desyncs) and are the single biggest source of pain in BA-on-mongo apps.

The one documented exception: bootstrap-time seeding before any session exists (see § 5).

---

## 4. Exposing BA's `member` collection as an arc resource

mongokit's `createBetterAuthOverlay` reads BA's resolved `tables.member` schema (including additionalFields) and registers ONE typed mongoose model on the existing collection. Arc auto-generates CRUD against it.

```ts
// src/resources/member/member.resource.ts
import { defineResource } from "@classytic/arc";
import { allowPublic, requireRoles } from "@classytic/arc/permissions";
import { buildCrudSchemasFromModel, QueryParser } from "@classytic/mongokit";
import { createBetterAuthOverlay } from "@classytic/mongokit/better-auth";
import { getAuth } from "#resources/auth/auth.config.js";

// Top-level await — runs during the resources phase (AFTER bootstrap[]),
// so `getAuth()` and mongoose are both ready.
const adapter = await createBetterAuthOverlay({
  auth: getAuth() as never,
  mongoose,
  collection: "member",
  schemaGenerator: buildCrudSchemasFromModel,
});

export default defineResource({
  name: "member",
  prefix: "/members",
  adapter,
  queryParser: new QueryParser({
    allowedFilterFields: ["division", "memberStatus", "role", "isPubliclyListed"],
    searchFields: ["displayName", "districtLabel", "roleLabel", "bio", "tags"],
  }),
  tenantField: false,
  // Membership creation flows through BA invite-accept; removal via
  // `auth.api.removeMember`. We expose only GET (public) + PATCH (admin).
  disabledRoutes: ["create", "delete"],
  permissions: {
    list:   allowPublic(),
    get:    allowPublic(),
    update: requireRoles(["admin"]),
  },
  schemaOptions: {
    fieldRules: {
      // BA owns these — never accept via PATCH.
      organizationId: { systemManaged: true },
      userId:         { systemManaged: true },
      role:           { systemManaged: true },
      createdAt:      { systemManaged: true },
      updatedAt:      { systemManaged: true },
    },
  },
});
```

Now `PATCH /api/members/:id` updates additionalFields (`displayName`, `bio`, etc) with field-rule validation. The FE calls `useMembers().update({ id, data })` — no custom controller required.

---

## 5. Bootstrap pattern (single-org seeding)

Single-tenant deployments need: an org row on first boot, a superadmin user added to it, idempotent across restarts.

```ts
// src/resources/auth/bootstrap.ts
export async function ensureFoundationOrg(): Promise<string> {
  // Run BEFORE any membership writes — defends against the duplicate-row trap below.
  await ensureMemberUniqueIndex();
  await collapseDuplicateMembers();

  const existing = await readOrgsFromDb().then((o) => o.find((x) => x.slug === FOUNDATION_SLUG));
  if (existing) return existing.id;

  // Direct mongoose insert — `auth.api.createOrganization` requires a session,
  // and at boot there's no caller. This is the documented bootstrap pattern.
  const _id = new mongoose.Types.ObjectId();
  await mongoose.connection.db!.collection("organization").insertOne({
    _id, name: FOUNDATION_NAME, slug: FOUNDATION_SLUG,
    createdAt: new Date(), updatedAt: new Date(),
  });
  return _id.toString();
}

export async function ensureBootstrapAdmin(orgId: string) {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;

  const auth = getAuth();
  const existing = await mongoose.connection.db!.collection("user").findOne({ email });
  let userId: string;
  if (existing) {
    userId = String(existing._id);
  } else {
    const res = await (auth.api.signUpEmail as never)({ body: { email, password, name: "Admin" } });
    userId = res.user.id;
  }
  // Promote to platform superadmin via the admin plugin.
  await (auth.api.setRole as never)({ body: { userId, role: "admin" } }).catch(() => undefined);

  // Org membership — guard against String/ObjectId type mismatch (see below).
  const memberCol = mongoose.connection.db!.collection("member");
  const orgOid = new mongoose.Types.ObjectId(orgId);
  const userOid = new mongoose.Types.ObjectId(userId);
  const already = await memberCol.findOne({
    $and: [
      { $or: [{ userId: userOid }, { userId }] },
      { $or: [{ organizationId: orgOid }, { organizationId: orgId }] },
    ],
  });
  if (!already) {
    await memberCol.insertOne({
      _id: new mongoose.Types.ObjectId(),
      organizationId: orgOid, userId: userOid, role: "admin", createdAt: new Date(),
    });
  }
}
```

### The duplicate-member trap

BA's mongo-adapter has historically written `userId` / `organizationId` as **either String or ObjectId** across versions. A naive `findOne({ userId: ObjectId(...) })` check misses legacy String-typed rows and inserts a duplicate. Two defenses:

```ts
async function ensureMemberUniqueIndex() {
  await mongoose.connection.db!.collection("member").createIndex(
    { organizationId: 1, userId: 1 },
    { unique: true, name: "uniq_org_user" },
  ).catch(() => {/* duplicates pending — collapseDuplicateMembers retries */});
}

async function collapseDuplicateMembers() {
  const col = mongoose.connection.db!.collection("member");
  const all = await col.find({}).toArray();
  const byKey = new Map<string, any[]>();
  for (const row of all) {
    const k = `${String(row.organizationId)}::${String(row.userId)}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k))!.push(row);
  }
  for (const [, rows] of byKey) {
    if (rows.length < 2) continue;
    // Prefer ObjectId-typed rows (current BA shape); within a tie, newest wins.
    rows.sort((a, b) => {
      const aObj = a.userId?.constructor?.name === "ObjectId" ? 1 : 0;
      const bObj = b.userId?.constructor?.name === "ObjectId" ? 1 : 0;
      return bObj - aObj || (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0);
    });
    const [keep, ...drop] = rows;
    await col.deleteMany({ _id: { $in: drop.map((d) => d._id) } });
    void keep;
  }
}
```

Run both in the order shown — `ensureMemberUniqueIndex` defends future writes, `collapseDuplicateMembers` cleans existing rows so the index can be created on the next pass.

---

## 6. Notifications (`@classytic/notifications`)

One singleton wraps `NotificationService`. Templates use `${var}` interpolation via `createSimpleResolver`.

```ts
// src/shared/notifications/notification.service.ts
import { ConsoleChannel, EmailChannel, NotificationService, createSimpleResolver, type Recipient, type TemplateMap } from "@classytic/notifications";

const TEMPLATES: TemplateMap = {
  organization_invitation: {
    subject: "You're invited to join ${organizationName}",
    html: /* html */ `<p>${"${inviterName}"} invited you to ${"${organizationName}"} as ${"${role}"}.<br>
      <a href="${"${inviteLink}"}">Accept invitation</a></p>`,
  },
  password_reset: {
    subject: "Reset your password",
    html: /* html */ `<p>Hi ${"${userName}"}, <a href="${"${resetLink}"}">reset here</a>.</p>`,
  },
};

let _service: NotificationService | null = null;
function getService() {
  if (_service) return _service;
  const channels = [];
  if (process.env.SMTP_HOST) {
    channels.push(new EmailChannel({
      name: "email",
      from: process.env.SMTP_FROM || "noreply@example.com",
      transport: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      },
    }));
  }
  // ConsoleChannel always-on in dev so admins can copy invite/reset URLs
  // straight from `npm run dev` even without a mail server.
  if (!process.env.SMTP_HOST || process.env.NODE_ENV !== "production") {
    channels.push(new ConsoleChannel({ name: "console" }));
  }
  return _service = new NotificationService({ channels, templates: createSimpleResolver(TEMPLATES) });
}

export async function notify(event: string, recipient: Recipient, data: Record<string, unknown>) {
  try {
    await getService().send({ event, recipient, data, template: event });
  } catch (err) {
    // Notifications are informational — don't break a successful auth flow
    // just because email is down. Log + swallow.
    console.error(`[notify] event=${event} failed:`, err);
  }
}
```

`@classytic/notifications` API gotchas:

- `NotificationServiceConfig.templates` (NOT `templateResolver`)
- `EmailChannelConfig.transport` (NOT `smtp`)
- Templates use raw strings + `${var}` interpolation, NOT functions

---

## 7. Custom-id pattern (friendly tracking handles)

Use mongokit's `customIdPlugin + dateSequentialId` for `INV-2026-0001` / `ORD-2026-0001` / `ANB-2026-0001` style IDs. Atomic counter in `_mongokit_counters` — safe under concurrent submissions.

```ts
customIdPlugin({
  field: "reportId",
  generator: dateSequentialId({
    prefix: "ANB",
    model: SupportRequest,
    partition: "yearly",   // or "monthly" / "daily"
    padding: 4,
    separator: "-",
  }),
}),
```

Then in the resource:

```ts
defineResource({
  idField: "reportId",                                     // URLs: /api/x/ANB-2026-0001
  schemaOptions: { fieldRules: { reportId: { systemManaged: true } } },
  actions: {
    transition: {
      handler: async (id /* this is reportId, NOT _id */, data, req) => {
        const doc = await Model.findOne({ reportId: id });
        if (!doc) throw new NotFoundError(...);
      },
    },
  },
});
```

Confirm the FE pins the matching `createCrudHooks({ idField: "reportId" })` so tanstack cache keys hash on the same handle the URL uses.

---

## 8. Boot lifecycle (do NOT reorder)

arc's lifecycle is fixed. Top-level `await` inside a `*.resource.ts` runs during slot 5 (resources), AFTER `bootstrap[]` — so mongoose + BA context are live when overlays / `getAuth()` are read.

```
1. arc core (security, auth, events)
2. plugins()                  ← infra (DB, SSE, docs)
3. bootstrap[]                ← domain init (ensureFoundationOrg, ensureBootstrapAdmin)
4. resources factory (if any) ← runs AFTER bootstrap, for engine-dependent adapters
5. resources[]                ← register each (top-level-await fires here)
6. afterResources()
7. onReady / onClose
```

Top-level await in `member.resource.ts` for `createBetterAuthOverlay` is the canonical pattern — works because of slot ordering above.

---

## 9. Common pitfalls

1. **String vs ObjectId in BA collections.** BA's mongo-adapter has written both shapes across versions. Any user-land lookup that uses ONE form misses rows in the other — use `$or: [{ userId: ObjectId }, { userId: "..." }]` for any pre-bootstrap-index query. Add the unique compound index ASAP and never look back.
2. **Forgetting `idField`** when using `customIdPlugin`. The plugin stamps `reportId` but URLs still hit `/:_id` if the resource doesn't bind it. Result: looks like the friendly handle "doesn't work."
3. **Action handlers calling `findById(id)`** when `idField` is set. `id` is the friendly handle, not the ObjectId. Use `findOne({ <idField>: id })`.
4. **BA `trustedOrigins` not mirroring `CORS_ORIGINS`.** Anything that passed CORS must pass BA's origin check too. The two-line union (see § 3) keeps them aligned.
5. **Direct collection writes** to BA's `verification` / `session` / `member` collections to skip BA hooks. Don't. Use `auth.api.*`.
6. **Vitest can't follow `.js` → `.ts` resolution through `loadResources`'s dynamic imports.** Pass `STATIC_RESOURCES` from `src/resources/index.ts` to `createAppInstance({ resources })` in test helpers.
7. **`auth.api.*` shape** — every call is `{ body: {...}, headers?, query? }`. NOT positional args. TS narrows poorly because plugin generics are wide; cast to `never` when invoking.
8. **`FRONTEND_URL` ≠ allow-list.** It builds email links (single value). The CORS array decides allowed origins. A single-URL `trustedOrigins` is the most common cause of "Invalid origin" on FE port mismatches.

---

## 10. Verification

```bash
npx tsc --noEmit                     # type-check
npm run dev                          # dev server (default port 8040)
npm run test                         # vitest (uses STATIC_RESOURCES)

# Smoke a resource
curl -s http://localhost:8040/_health
curl -s -X POST http://localhost:8040/api/<resource> -H 'content-type: application/json' -d '{...}'
```

For end-to-end browser flows that depend on BA cookies/origins, drive them via the Next.js MCP on the FE side — `curl` won't surface the `Invalid origin` 403s the browser does.

---

## 11. Decision rules

- **Adding fields to a BA-owned collection** → prefer `additionalFields` in `auth.config.ts` + `createBetterAuthOverlay` on the arc resource side. Custom controllers are only for things BA doesn't model (e.g. resource-specific FSM transitions).
- **Adding a non-CRUD endpoint** → `actions: {...}` in `defineResource` (auto-routes to `POST /:id/action`). Don't use `additionalRoutes` unless you need a non-`:id`-scoped path.
- **Single-tenant** → `tenantField: false` everywhere. Multi-tenant → set the field name and arc auto-scopes queries by `req.scope.organizationId`.
- **Bypassing BA** → don't, except documented bootstrap seeding.
- **Bypassing arc** → don't. If you need raw access, write a custom action handler instead.

---

## 12. App-level concerns belong elsewhere

What this file deliberately does NOT specify (those are project decisions, document them in `CLAUDE.md` or your project memory):

- Specific role names (`admin` / `committee_member` / `general` vs `owner` / `editor` / `viewer`)
- Specific resource names, prefixes, or category enums
- Bootstrap env-var names (`ANIRBAN_BOOTSTRAP_*` vs another convention)
- SMTP provider choice / from address / template copy
- Field rules for app-specific entities (member directory schema, support categories)
- Notification template content / event names
- Mongo connection URI / database name
