/**
 * Notification Service — anirban-be
 *
 * One singleton built on `@classytic/notifications`. Used by:
 *
 *   - `auth.config.ts` for `sendInvitationEmail` (`organization_invitation`),
 *     `sendResetPassword` (`password_reset`), and email verification.
 *   - Any future workflow that needs to ping a survivor (case-status updates,
 *     ministry escalation receipts, etc.).
 *
 * In dev (no SMTP env vars), the service falls back to a `ConsoleChannel` so
 * notifications print to the server log — the same dev-loop AI Hire uses, but
 * here it's automatic instead of a stub. In prod (`SMTP_HOST` set), the SMTP
 * channel takes over and `notify()` actually sends.
 *
 * The exported `notify(event, recipient, data)` helper matches the signature
 * used across other classytic apps (AI Hire, etc.) so the call sites stay
 * portable across services.
 */

import {
  ConsoleChannel,
  EmailChannel,
  NotificationService,
  createSimpleResolver,
  type Recipient,
  type TemplateMap,
} from '@classytic/notifications';

/**
 * Event names — keep in sync with the templates below. Adding a new event
 * means: (a) add a template entry, (b) wire a `notify("<name>", ...)` call.
 */
export type NotificationEvent =
  | 'organization_invitation'
  | 'password_reset'
  | 'email_verification';

/**
 * Templates — `subject` + `html` per event using `${key}` interpolation
 * (resolved by `createSimpleResolver`). Plain-text fallback uses the
 * subject; clients without HTML rendering still see something meaningful.
 * Keep these tight: every line shows up in production inboxes.
 */
const TEMPLATES: TemplateMap = {
  organization_invitation: {
    subject: "You're invited to join ${organizationName}",
    html: /* html */ `
<div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; color: #0a0a0a;">
  <h2 style="font-size: 22px; font-weight: 800; margin-bottom: 8px;">Welcome to \${organizationName}</h2>
  <p style="margin: 0 0 16px;">\${inviterName} has invited you to join <strong>\${organizationName}</strong> as a <strong>\${role}</strong>.</p>
  <p style="margin: 0 0 24px;">Click below to accept the invitation and set up your account. The link is valid for the next 48 hours.</p>
  <p><a href="\${inviteLink}" style="display: inline-block; background: #c2410c; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 700;">Accept invitation</a></p>
  <p style="margin-top: 24px; color: #666; font-size: 13px;">If the button doesn't work, paste this link in your browser:<br/><span style="word-break: break-all;">\${inviteLink}</span></p>
</div>`,
  },

  password_reset: {
    subject: 'Reset your Anirban password',
    html: /* html */ `
<div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; color: #0a0a0a;">
  <h2 style="font-size: 22px; font-weight: 800;">Hi \${userName},</h2>
  <p>We received a request to reset your password. Click below to choose a new one:</p>
  <p><a href="\${resetLink}" style="display: inline-block; background: #c2410c; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 700;">Reset password</a></p>
  <p style="color: #666; font-size: 13px;">If you didn't ask for this, ignore this email — your password stays unchanged.</p>
</div>`,
  },

  email_verification: {
    subject: 'Verify your email — Anirban',
    html: /* html */ `
<div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; color: #0a0a0a;">
  <h2 style="font-size: 22px; font-weight: 800;">Confirm your email</h2>
  <p>Hi \${userName}, please confirm your email so we can secure your account.</p>
  <p><a href="\${verificationLink}" style="display: inline-block; background: #c2410c; color: white; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 700;">Verify email</a></p>
</div>`,
  },
};

let _service: NotificationService | null = null;

/**
 * Lazy singleton — built on first `notify()` call so module-load doesn't
 * panic when env vars aren't wired (dev / tests).
 */
function getService(): NotificationService {
  if (_service) return _service;

  const channels = [];

  // Production / staging: real SMTP. Set the four env vars and email goes
  // out via nodemailer (auto-loaded by `@classytic/notifications` when the
  // package is installed). Skip silently when host isn't configured — the
  // ConsoleChannel below covers dev so calls never crash.
  if (process.env.SMTP_HOST) {
    channels.push(
      new EmailChannel({
        name: 'email',
        from: process.env.SMTP_FROM || 'noreply@anirban.org',
        transport: {
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth:
            process.env.SMTP_USER && process.env.SMTP_PASS
              ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
              : undefined,
        },
      }),
    );
  }

  // Always-on dev fallback. Prints to the server log so admins can copy
  // invite links, password-reset URLs etc. straight from `npm run dev`.
  // Disabled in prod (when SMTP is configured) so we don't double-deliver.
  if (!process.env.SMTP_HOST || process.env.NODE_ENV !== 'production') {
    channels.push(new ConsoleChannel({ name: 'console' }));
  }

  _service = new NotificationService({
    channels,
    templates: createSimpleResolver(TEMPLATES),
  });

  return _service;
}

/**
 * Send a notification.
 *
 * @param event       Template key (must exist in `TEMPLATES` above).
 * @param recipient   `{ email, name? }` — passed straight to channels.
 * @param data        Variables interpolated into the template.
 *
 * @example
 *   await notify(
 *     'organization_invitation',
 *     { email: applicant.email, name: applicant.name },
 *     { email: applicant.email, organizationName: 'Anirban',
 *       role: 'general', inviterName: 'Admin', inviteLink: '...' },
 *   );
 */
export async function notify(
  event: NotificationEvent,
  recipient: Recipient,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await getService().send({
      event,
      recipient,
      data,
      template: event,
    });
  } catch (err) {
    // Notifications are *informational*: don't break a successful auth flow
    // (invite created OK, etc.) just because email is down. Log + swallow.
    console.error(`[notify] event=${event} failed:`, err);
  }
}
