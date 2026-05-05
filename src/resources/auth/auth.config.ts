/**
 * Better Auth — anirban-be
 *
 * Single-tenant deployment (the org IS Anirban). We still use BA's
 * `organization` plugin because it gives us — for free — the invitation
 * flow, role assignment, AC, and a `member` collection that joins users
 * to roles. The only difference from a multi-tenant app is that ONE org
 * is auto-seeded at boot and every member belongs to it.
 *
 * Plugins:
 *   - admin          — superadmin role, ban, impersonate
 *   - bearer         — `Authorization: Bearer <token>` (cookieless)
 *   - organization   — invitation, member roles, AC
 *
 * AC roles defined in `resources/auth/access-control.ts`:
 *   admin, committee_member, general.
 *
 * Membership-request approval calls `auth.api.createInvitation()` to
 * onboard the applicant — BA owns the email + accept flow. We never DIY
 * user creation.
 */

import { betterAuth } from 'better-auth';
import { admin as adminPlugin, bearer, organization } from 'better-auth/plugins';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { mirrorTrustedOriginsFromCors } from '@classytic/arc/auth';
import { registerBetterAuthStubs } from '@classytic/mongokit/better-auth';
import mongoose from 'mongoose';
import config from '#config/index.js';
import {
  ac,
  admin as adminRole,
  committee_member,
  general,
} from '#resources/auth/access-control.js';
import { notify } from '#shared/notifications/notification.service.js';

// BA with plugins (admin, bearer, organization) produces a wider generic
// than base `ReturnType<typeof betterAuth>` — the static type is impractical
// to declare. arc only needs the `handler` + `api` surface, so we narrow to
// the structural shape it consumes.
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
        // BA generates the token + URL; we only own the email body. The
        // `url` BA passes already includes the callback param the frontend
        // expects, but we route to our own `/reset-password` page so the
        // user lands in the Anirban UI rather than BA's default route.
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
      // helper (single source of truth for the union rule across every
      // classytic backend). Returns `["*"]` for wildcard CORS,
      // `[frontendUrl, ...cors]` deduped otherwise.
      trustedOrigins: mirrorTrustedOriginsFromCors({
        corsOrigins: config.cors.origins,
        canonicalUrl: config.frontend.url,
      }),

      rateLimit: {
        enabled: process.env.NODE_ENV === 'production',
      },

      plugins: [
        bearer(),
        // BA's default `admin`/`user` user-level roles handle platform-level
        // ban/impersonate. Foundation-specific roles (admin, committee_member,
        // general) layer on top via the `organization` plugin AC below.
        adminPlugin(),
        organization({
          // Foundation members can't spin up new orgs — only the seed creates one.
          allowUserToCreateOrganization: false,
          creatorRole: 'admin',
          membershipLimit: 5000,
          ac,
          roles: { admin: adminRole, committee_member, general },
          schema: {
            // Survivor-profile fields live on the `member` collection so the
            // identity (BA `user`) stays portable and the member directory
            // carries the brand-facing data. The marketing `/members` page
            // reads these straight off the BA-overlay arc resource —
            // `division` / `districtLabel` drive its filter chips,
            // `roleLabel` / `bio` / `tags` populate each card,
            // `memberStatus` drives the colour-coded status badge.
            member: {
              additionalFields: {
                displayName: { type: 'string', required: false },
                imageUrl: { type: 'string', required: false },
                survivorStory: { type: 'string', required: false },
                phone: { type: 'string', required: false },
                joinedAt: { type: 'date', required: false },
                isPubliclyListed: { type: 'boolean', required: false, defaultValue: true },
                // Public directory fields ─ FE marketing page consumes these.
                /** BD division code: BDA / BDB / BDC / BDD / BDE / BDF / BDG / BDH. */
                division: { type: 'string', required: false },
                /** Free-text district / city label for the directory card. */
                districtLabel: { type: 'string', required: false },
                /** Public-facing role string ("Survivor Advocate", "Legal Counsel", ...). */
                roleLabel: { type: 'string', required: false },
                /** Short directory bio (1–2 sentences). */
                bio: { type: 'string', required: false },
                /** Comma-separated tags ("Peer Support, Bengali"). FE splits client-side. */
                tags: { type: 'string', required: false },
                /** founding | active | ambassador | alumni — drives the badge. */
                memberStatus: { type: 'string', required: false, defaultValue: 'active' },
              },
            },
          },
          // Invitation email — frontend hosts the accept page, BA generates
          // the link. Routed through `@classytic/notifications`: real SMTP in
          // prod (when SMTP_HOST is set), ConsoleChannel in dev so admins
          // can copy the URL straight from server logs even without a mail
          // server.
          sendInvitationEmail: async (data: Record<string, unknown>) => {
            const d = data as {
              email: string;
              role?: string;
              id: string;
              organization?: { name?: string };
              inviter?: { user?: { name?: string; email?: string } };
            };
            const inviteLink = `${config.frontend.url}/accept-invitation/${d.id}`;
            const inviterName =
              d.inviter?.user?.name || d.inviter?.user?.email || 'An Anirban admin';
            await notify(
              'organization_invitation',
              { email: d.email, name: d.email },
              {
                email: d.email,
                organizationName: d.organization?.name || 'Anirban',
                role: d.role || 'general',
                inviterName,
                inviteLink,
              },
            );
          },
        }),
      ],
    });

    // Mongoose stubs so `.populate('user')`, `.populate('organization')`,
    // `.populate('invitation')` resolve from arc resources without
    // strict-schema friction. Plugin-aware — picks up the
    // `additionalFields` shape declared above.
    //
    // Note on `Member`: `src/resources/member/member.resource.ts` calls
    // `createBetterAuthOverlay({ collection: 'member' })` which registers
    // its own typed mongoose model on the resolved schema. The stub
    // helper is idempotent (skips already-registered models), so this
    // call still wires `Invitation` / `Team` for `.populate()` from
    // other resources without conflicting with the overlay.
    registerBetterAuthStubs(mongoose, { plugins: ['organization'] });
  }

  return _auth;
}

export default getAuth;
