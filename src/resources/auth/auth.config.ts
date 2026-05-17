/**
 * Better Auth — anirban-be
 *
 * BA's job here is narrow: identity (login, password reset) and platform
 * admin actions (ban, impersonate). The foundation's domain — members,
 * roles, directory listing — lives in the arc resource layer over plain
 * mongoose, not in BA's `organization` plugin.
 *
 * Plugins:
 *   - admin   — platform-level actions + carries the foundation role on
 *               `user.role` (`admin | committee_member | general`).
 *   - bearer  — `Authorization: Bearer <token>` (cookieless clients).
 *
 * Why no `organization` plugin: single-tenant + every member doesn't
 * need a login (survivor advocates, alumni, ambassadors). Coupling the
 * directory to BA's `member` collection forced a one-row-per-user model
 * and a String/ObjectId duplicate-row trap. arc's `requireRoles(['admin'])`
 * reads `request.scope.userRoles` (set from `user.role` by the BA auth
 * adapter), so role checks work end-to-end without org context.
 */

import { betterAuth } from 'better-auth';
import { admin as adminPlugin, bearer } from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { mirrorTrustedOriginsFromCors } from '@classytic/arc/auth';
import { registerBetterAuthStubs } from '@classytic/mongokit/better-auth';
import mongoose from 'mongoose';
import config from '#config/index.js';
import { notify } from '#shared/notifications/notification.service.js';

// ----------------------------------------------------------------------------
// Access-control roles for BA's admin plugin.
//
// BA validates that every entry in `adminRoles` exists as a key in `roles`
// (built-in defaults only ship `admin` + `user`). We declare both `admin`
// and `superadmin` against the same default statement set, sharing the full
// admin permission surface. Anirban doesn't use BA's fine-grained
// permission checks in code — arc's `requireRoles(['admin'])` /
// `requireRoles(['superadmin'])` does string-level role gating — so we
// don't need to diverge their statement lists. The two roles differ only
// in what application-layer routes accept them (see `dashboard/email/setup`
// for an example of a superadmin-only page).
// ----------------------------------------------------------------------------
const accessControl = createAccessControl(defaultStatements);
const ADMIN_STATEMENTS = {
  user: [
    'create',
    'list',
    'set-role',
    'ban',
    'impersonate',
    'delete',
    'set-password',
    'get',
    'update',
  ],
  session: ['list', 'revoke', 'delete'],
} as const;
const adminRole = accessControl.newRole(ADMIN_STATEMENTS);
const superadminRole = accessControl.newRole({
  ...ADMIN_STATEMENTS,
  // Superadmins can impersonate other admins, not just regular users — the
  // extra statement exists for that.
  user: [...ADMIN_STATEMENTS.user, 'impersonate-admins'],
});

// BA + plugins (admin, bearer) widens the generic past base
// `ReturnType<typeof betterAuth>`. arc only consumes `handler` + `api`,
// so we narrow to that structural shape.
let _auth:
  | { handler: (request: Request) => Promise<Response>; api: Record<string, unknown> }
  | null = null;

export function getAuth() {
  if (process.env.NODE_ENV === 'production' && !process.env.BETTER_AUTH_SECRET) {
    throw new Error('BETTER_AUTH_SECRET is required in production (min 32 chars)');
  }

  if (!_auth) {
    _auth = betterAuth({
      secret: config.betterAuth.secret,
      baseURL: process.env.BETTER_AUTH_URL || `http://localhost:${config.server.port}`,
      basePath: '/api/auth',

      database: mongodbAdapter(mongoose.connection.getClient().db() as never),

      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        // BA generates the token + URL; we own the email body. The `url`
        // BA passes carries the callback param the FE expects, but we
        // route to our own `/reset-password` page.
        sendResetPassword: async ({ user, url, token }) => {
          const callbackURL =
            new URL(url).searchParams.get('callbackURL') ||
            `${config.frontend.url}/reset-password`;
          const resetLink = `${callbackURL}?token=${token}`;
          await notify(
            'password_reset',
            { email: user.email, name: user.name },
            {
              userName: user.name || user.email,
              resetLink,
            },
          );
        },
      },

      session: {
        cookieCache: { enabled: true, maxAge: 5 * 60 },
      },

      // Mirror CORS allow-list into BA's CSRF/origin check via arc's
      // helper. Returns `["*"]` for wildcard CORS, `[frontendUrl, ...cors]`
      // deduped otherwise.
      trustedOrigins: mirrorTrustedOriginsFromCors({
        corsOrigins: config.cors.origins,
        canonicalUrl: config.frontend.url,
      }),

      rateLimit: {
        enabled: process.env.NODE_ENV === 'production',
      },

      plugins: [
        bearer(),
        // BA admin plugin stores a single `role` string on every user.
        // The foundation role hierarchy:
        //   superadmin       — infrastructure (SMTP setup, env keys, the
        //                      bootstrap-seeded founder). Above `admin`
        //                      in the trust ladder; everything `admin`
        //                      can do, plus the setup/operations pages.
        //   admin            — full domain surface (members, chapters,
        //                      requests, broadcasts) + BA ban/impersonate.
        //                      Does NOT see infrastructure / setup pages.
        //   committee_member — runs the support-request workflow.
        //   general          — basic foundation member.
        //
        // Both `superadmin` and `admin` count as platform admins to BA so
        // ban/impersonate / userInfo work for either. arc's auth adapter
        // copies `user.role` into `request.scope.userRoles`, and
        // `requireRoles(['admin'])` matches against the list — pass
        // `requireRoles(['superadmin'])` server-side when a route is
        // infrastructure-only.
        adminPlugin({
          defaultRole: 'general',
          adminRoles: ['admin', 'superadmin'],
          ac: accessControl,
          roles: {
            admin: adminRole,
            superadmin: superadminRole,
          },
        }),
      ],
    });

    // Mongoose stubs so `.populate('user')` resolves from arc resources
    // without strict-schema friction. Org plugin is gone, so we don't
    // need its stubs anymore — the default (user/session/account) is
    // sufficient.
    registerBetterAuthStubs(mongoose);
  }

  return _auth;
}

export default getAuth;
