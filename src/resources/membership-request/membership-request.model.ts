/**
 * MembershipRequest — public application to join the foundation.
 *
 * No timeline-audit here on purpose: this is a 3-state form (`pending →
 * approved | rejected`), not a workflow. The actual member onboarding
 * lifecycle lives in BA's `invitation` + `member` collections once the
 * admin approves and an invitation is sent.
 */

import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema } = mongoose;

export type MembershipRequestStatus = 'pending' | 'approved' | 'rejected';

export type TraffickingType = 'internal' | 'cross-border';

/** Predefined keys — the FE renders the labels via a translation table. */
export type ContributionArea =
  | 'community_awareness'
  | 'survivor_support'
  | 'leadership_advocacy'
  | 'social_media_campaigns'
  | 'training_capacity_building';

export type SkillArea =
  | 'public_speaking'
  | 'community_organizing'
  | 'social_media_management'
  | 'writing_documentation'
  | 'peer_support_counseling';

export type SupportArea =
  | 'legal'
  | 'mental_health'
  | 'safety_protection'
  | 'livelihood_reintegration'
  | 'no_immediate_support';

export interface IMembershipRequest {
  applicantName: string;
  /** Whether the applicant prefers their public name to differ from `applicantName`. */
  usePseudonym?: boolean;
  /** Required when `usePseudonym` is true — used as the public display name. */
  pseudonym?: string;

  /** Optional — applicant may not have a personal email (rural BD, shared
   *  household contact). Phone alone is enough for an admin to follow up
   *  manually. When set + the request is approved, admin can promote the
   *  applicant to a login-capable account by creating a BA `user`. */
  email?: string;
  /** Mobile number — primary contact line. */
  phone?: string;
  /** Trusted contact reachable in an emergency. */
  emergencyContact?: string;
  /** WhatsApp number when different from `phone` (common in BD). */
  whatsappNumber?: string;

  imageUrl?: string;
  /** The applicant's survivor story; optional, surfaced to admin reviewers. */
  survivorStory?: string;

  /** Trafficking experience — applicant self-classifies. */
  traffickingType?: TraffickingType;
  /** Free-text year or approximate period (e.g. "2017", "2015–2018"). */
  traffickingPeriod?: string;

  /**
   * BD division code — `BDA` … `BDH`. Lines up with `BD_LOCATIONS` on the
   * FE so admin reviewers see the same labels the applicant picked.
   * Pre-fills the same field on the BA member doc when the application
   * is approved.
   */
  division?: string;
  /** District / zila label (free-text — the FE picks from a static list). */
  districtLabel?: string;
  /** Sub-district / police station / upazila — finer location granularity. */
  subDistrict?: string;

  /** Public-facing role string — applicant's preferred contribution
   *  (`Survivor Advocate`, `Legal Counsel`, `Community Organizer`, …). */
  roleLabel?: string;
  /** Short directory bio (1–2 sentences). Surfaces on the public `/members`
   *  card after approval. */
  bio?: string;

  /** Why the applicant wants to join Anirban — required free-text. */
  motivation?: string;
  /** Multi-select keys — what areas the applicant wants to contribute in. */
  contributionAreas?: ContributionArea[];
  /** Free-text overflow when applicant ticked "Other" for contribution. */
  contributionOther?: string;
  /** Multi-select keys — applicant's existing skill set. */
  skills?: SkillArea[];
  skillsOther?: string;
  /** Multi-select keys — what support the applicant needs right now. */
  supportNeeded?: SupportArea[];
  supportNeededOther?: string;

  /** Persisted consent flag for compliance — `true` once the applicant
   *  submitted with the consent box ticked. */
  consentGiven?: boolean;

  status: MembershipRequestStatus;

  /** Optional pointer to the `Member` row created on approval. */
  memberId?: string;
  /** BA user id of the admin who reviewed. */
  reviewedBy?: string;
  reviewedAt?: Date;
  /** Required when status is `rejected`. */
  rejectionReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type MembershipRequestDocument = HydratedDocument<IMembershipRequest>;

const membershipRequestSchema = new Schema<IMembershipRequest>(
  {
    applicantName: { type: String, required: true, trim: true },
    usePseudonym: { type: Boolean, default: false },
    pseudonym: { type: String, trim: true },

    email: { type: String, trim: true, lowercase: true, index: true, sparse: true },
    phone: { type: String, trim: true },
    emergencyContact: { type: String, trim: true },
    whatsappNumber: { type: String, trim: true },

    imageUrl: { type: String, trim: true },
    // Was required pre-spec-revision. The applicant's full story is now
    // optional ("share only what you feel comfortable sharing"); the
    // required free-text field is `motivation`.
    survivorStory: { type: String, trim: true },

    traffickingType: {
      type: String,
      enum: ['internal', 'cross-border'],
    },
    traffickingPeriod: { type: String, trim: true },

    division: { type: String, trim: true, index: true },
    districtLabel: { type: String, trim: true, index: true },
    subDistrict: { type: String, trim: true },

    roleLabel: { type: String, trim: true },
    bio: { type: String, trim: true },

    motivation: { type: String, trim: true },
    contributionAreas: {
      type: [String],
      enum: [
        'community_awareness',
        'survivor_support',
        'leadership_advocacy',
        'social_media_campaigns',
        'training_capacity_building',
      ],
      default: undefined,
    },
    contributionOther: { type: String, trim: true },
    skills: {
      type: [String],
      enum: [
        'public_speaking',
        'community_organizing',
        'social_media_management',
        'writing_documentation',
        'peer_support_counseling',
      ],
      default: undefined,
    },
    skillsOther: { type: String, trim: true },
    supportNeeded: {
      type: [String],
      enum: [
        'legal',
        'mental_health',
        'safety_protection',
        'livelihood_reintegration',
        'no_immediate_support',
      ],
      default: undefined,
    },
    supportNeededOther: { type: String, trim: true },

    consentGiven: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    memberId: { type: String, index: true, sparse: true },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
  },
  { timestamps: true },
);

// One pending application per email at a time. A rejected applicant can
// re-apply after admin clears or status is bumped. Partial filter limits
// the unique constraint to rows that actually carry an email — email-less
// applications (phone-only) bypass the constraint and are deduped manually.
membershipRequestSchema.index(
  { email: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending', email: { $type: 'string' } },
  },
);

const MembershipRequest: Model<IMembershipRequest> =
  (mongoose.models.MembershipRequest as Model<IMembershipRequest> | undefined) ??
  mongoose.model<IMembershipRequest>('MembershipRequest', membershipRequestSchema);

export default MembershipRequest;
