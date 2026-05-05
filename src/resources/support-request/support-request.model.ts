/**
 * SupportRequest — public complaint / help submission with workflow.
 *
 * Workflow states:
 *   pending → in_review → in_ministry → resolved | closed
 *                                          ↑
 *                                      reopen → in_review
 *
 * Every state transition runs through a resource action (`startReview`,
 * `escalateToMinistry`, `resolve`, `close`, `reopen`) and is recorded by
 * the `mongoose-timeline-audit` plugin — actor (committee member /
 * admin / system), event type, free-form note, structured metadata.
 *
 * The submitter is anonymous-by-default — only the `submitter*` contact
 * fields they choose to provide are stored. No BA user ref required, so
 * anyone in the public can file a complaint.
 */

import mongoose, { type HydratedDocument, type Model, type Types } from 'mongoose';
import timelineAuditPlugin, { type TimelineEvent } from 'mongoose-timeline-audit';

const { Schema } = mongoose;

export type SupportRequestStatus =
  | 'pending'
  | 'in_review'
  | 'in_ministry'
  | 'resolved'
  | 'closed';

export type SupportRequestCategory =
  | 'trafficking_report'
  | 'child_marriage'
  | 'domestic_violence'
  | 'workplace_harassment'
  | 'sexual_assault'
  | 'legal_help'
  | 'reintegration'
  | 'other';

export type SupportRequestPriority = 'low' | 'normal' | 'high' | 'urgent';

export type AgeRange = '<18' | '18-24' | '25-34' | '35-44' | '45-54' | '55+' | 'prefer_not_to_say';

/** Support categories the FE checkboxes map into. */
export type SupportNeed =
  | 'legal_aid'
  | 'counselling'
  | 'safe_housing'
  | 'medical_help'
  | 'just_to_talk'
  | 'diaspora_abroad';

export interface ISupportRequest {
  _id: Types.ObjectId;

  /**
   * Public-facing tracking handle (e.g. `ANB-2026-0001`). Auto-stamped on
   * create by mongokit's `customIdPlugin` + `dateSequentialId` (yearly
   * partition) — see `support-request.repository.ts`. Used as the resource's
   * `idField` so every route resolves cases by this human-friendly code
   * rather than the raw ObjectId.
   */
  reportId: string;

  /** Submitter — public, no auth. Optional for anonymous filings. */
  submitterName?: string;
  submitterEmail?: string;
  submitterPhone?: string;
  /** Optional age range from the form's "About you" step. */
  ageRange?: AgeRange;
  /** City / region the survivor is based in — drives local referral routing. */
  city?: string;

  category: SupportRequestCategory;
  subject: string;
  description: string;
  /** Approximate date of the incident (free-text — submitters may not know exact). */
  incidentWhen?: string;
  attachmentUrls: string[];

  /** Multi-select from the form's "Support needed" step. */
  supports: SupportNeed[];
  /** Submitter's preferred contact channel — copy-text from the FE. */
  bestReach?: string;

  status: SupportRequestStatus;
  priority: SupportRequestPriority;

  /** BA member id of the committee/admin assigned to handle. */
  assignedTo?: string;

  /** Workflow audit trail — populated by mongoose-timeline-audit. */
  timeline: TimelineEvent[];

  createdAt: Date;
  updatedAt: Date;
}

export type SupportRequestDocument = HydratedDocument<ISupportRequest>;

const supportRequestSchema = new Schema<ISupportRequest>(
  {
    // `unique` + `index` so the FE-facing tracking code is enforced at the DB
    // layer; the customIdPlugin generates it via an atomic counter so races
    // can't produce duplicates, but the unique index is the ultimate guard.
    reportId: { type: String, required: true, unique: true, index: true },

    submitterName: { type: String, trim: true },
    submitterEmail: { type: String, trim: true, lowercase: true },
    submitterPhone: { type: String, trim: true },
    ageRange: {
      type: String,
      enum: ['<18', '18-24', '25-34', '35-44', '45-54', '55+', 'prefer_not_to_say'],
    },
    city: { type: String, trim: true, index: true },

    // `/get-help` (public form) doesn't surface a category picker — every
    // submission lands in `other` until a committee triages and updates it.
    // The FE's free-text `incidentType` is captured in `subject` instead.
    category: {
      type: String,
      enum: [
        'trafficking_report',
        'child_marriage',
        'domestic_violence',
        'workplace_harassment',
        'sexual_assault',
        'legal_help',
        'reintegration',
        'other',
      ],
      default: 'other',
      index: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true },
    incidentWhen: { type: String, trim: true },
    attachmentUrls: { type: [String], default: [] },

    supports: {
      type: [String],
      enum: [
        'legal_aid',
        'counselling',
        'safe_housing',
        'medical_help',
        'just_to_talk',
        'diaspora_abroad',
      ],
      default: [],
    },
    bestReach: { type: String, trim: true },

    status: {
      type: String,
      enum: ['pending', 'in_review', 'in_ministry', 'resolved', 'closed'],
      default: 'pending',
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal',
      index: true,
    },

    assignedTo: { type: String, index: true },
  },
  { timestamps: true },
);

// Workflow audit — every status transition / note is appended to
// `timeline[]` with actor, type, description, and metadata. The plugin
// owns the schema for the `timeline` field; we don't declare it above.
supportRequestSchema.plugin(timelineAuditPlugin, {
  // `assignedTo` is the closest thing to "owner" once a complaint is
  // assigned; for unassigned/anonymous submissions the plugin still
  // captures actor info via the request.
  ownerField: 'assignedTo',
  fieldName: 'timeline',
  eventLimits: {
    // Free-form notes can rack up; cap them. Workflow transitions stay
    // unlimited (every state change is auditable forever).
    'support.note_added': 50,
  },
});

const SupportRequest: Model<ISupportRequest> =
  (mongoose.models.SupportRequest as Model<ISupportRequest> | undefined) ??
  mongoose.model<ISupportRequest>('SupportRequest', supportRequestSchema);

export default SupportRequest;
