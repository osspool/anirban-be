/**
 * Email Broadcast Plugin — `POST /api/email/send`
 *
 * Lets admins send ad-hoc HTML email to one or many recipients via the
 * configured channel (Resend SMTP in prod, ConsoleChannel in dev). Built
 * on the existing `@classytic/notifications` singleton — no new transport
 * to wire, just an ad-hoc broadcast on top of the same NotificationService
 * used for password resets and invitations.
 *
 * Why a Fastify plugin and not an arc resource?
 *   - There's no collection backing "email" — this is an *action* endpoint
 *     with no list / get / patch / delete surface.
 *   - Keeping it as a portable plugin means dropping the same file into a
 *     sibling project gives them broadcasting for free.
 *
 * Auth strategy:
 *   - Forward the request's `Authorization` header to better-auth's
 *     `GET /api/auth/get-session` and read `user.role`.
 *   - That's the same source of truth arc's `requireRoles(['admin'])`
 *     reads (BA's admin plugin populates `user.role`), so a user who can
 *     hit any other admin route can hit this one.
 *   - No dependency on arc's decorators — keeps the plugin portable to
 *     any Fastify+BetterAuth stack.
 *
 * Rate / abuse guards:
 *   - max 500 recipients per call (cheap defence against a leaked key)
 *   - subject + html required and non-empty
 *   - recipient email shape sanity-checked server-side
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';
import {
  sendBroadcast,
  type BroadcastRecipient,
} from '../shared/notifications/notification.service.js';

const MAX_RECIPIENTS = 500;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface BroadcastBody {
  recipients?: ReadonlyArray<{ email?: string; name?: string }>;
  subject?: string;
  html?: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

interface BetterAuthSessionResponse {
  user?: {
    id?: string;
    email?: string;
    role?: string | string[];
    name?: string;
  } | null;
}

/**
 * Resolve the requester's BA session by calling the local
 * `/api/auth/get-session` endpoint. Returns `null` for unauthenticated.
 *
 * Loopback fetch is cheap (same process, in-memory after warmup) and
 * means we don't have to know which BA `auth` instance is wired — the
 * BA route handles whatever the rest of the app handles.
 */
async function resolveSession(
  req: FastifyRequest,
): Promise<BetterAuthSessionResponse['user'] | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  // Fastify exposes the listening port via `server.address()`.
  const address = req.server.server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : null;
  if (!port) return null;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/get-session`, {
      headers: {
        authorization: authHeader,
        // BA requires an Origin header in bearer mode; forward whatever
        // the original request had, or fall back to a localhost origin.
        origin:
          (req.headers.origin as string | undefined) ?? 'http://localhost',
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as BetterAuthSessionResponse;
    return json.user ?? null;
  } catch {
    return null;
  }
}

function userHasAdminRole(role: string | string[] | undefined): boolean {
  if (!role) return false;
  if (Array.isArray(role)) return role.includes('admin');
  return role.split(/[,\s]+/g).includes('admin');
}

const emailBroadcastPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/api/email/send', async (req, reply) => {
    // ── Auth: admin only (BA `user.role` resolved via loopback) ──────────
    const user = await resolveSession(req);
    if (!user) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    if (!userHasAdminRole(user.role)) {
      return reply.code(403).send({ error: 'Admin role required' });
    }

    // ── Validate body ────────────────────────────────────────────────────
    const body = (req.body ?? {}) as BroadcastBody;

    const subject = (body.subject ?? '').trim();
    const html = (body.html ?? '').trim();
    if (!subject) return reply.code(400).send({ error: 'subject is required' });
    if (!html) return reply.code(400).send({ error: 'html is required' });

    const rawRecipients = body.recipients ?? [];
    if (!Array.isArray(rawRecipients) || rawRecipients.length === 0) {
      return reply.code(400).send({ error: 'recipients[] required' });
    }
    if (rawRecipients.length > MAX_RECIPIENTS) {
      return reply.code(400).send({
        error: `Too many recipients (max ${MAX_RECIPIENTS} per send). Split into multiple batches.`,
      });
    }

    // Dedupe + lowercase + shape-check. Bad rows are reported back so the
    // admin can fix them; we don't reject the whole send if 1/100 is bad.
    const seen = new Set<string>();
    const valid: BroadcastRecipient[] = [];
    const invalid: Array<{ email: string; reason: string }> = [];
    for (const raw of rawRecipients) {
      const email = (raw?.email ?? '').trim().toLowerCase();
      if (!email) {
        invalid.push({ email: '', reason: 'missing email' });
        continue;
      }
      if (!EMAIL_REGEX.test(email)) {
        invalid.push({ email, reason: 'invalid email format' });
        continue;
      }
      if (seen.has(email)) continue;
      seen.add(email);
      valid.push({ email, name: raw?.name?.trim() || undefined });
    }

    if (valid.length === 0) {
      return reply
        .code(400)
        .send({ error: 'No valid recipients', invalid });
    }

    // ── Dispatch ─────────────────────────────────────────────────────────
    try {
      const summary = await sendBroadcast({
        recipients: valid,
        subject,
        html,
        text: body.text?.trim() || undefined,
        from: body.from?.trim() || undefined,
        replyTo: body.replyTo?.trim() || undefined,
      });

      return reply.code(200).send({
        ...summary,
        invalid,
      });
    } catch (err) {
      // sendBroadcast only throws on programmer error (it captures
      // per-recipient failures internally). If we're here, something
      // upstream is broken — log + bubble up.
      const message = err instanceof Error ? err.message : 'Broadcast failed';
      req.log.error({ err }, '[email-broadcast] dispatch failed');
      return reply.code(502).send({ error: message });
    }
  });
};

export default fp(emailBroadcastPlugin, { name: 'email-broadcast' });
