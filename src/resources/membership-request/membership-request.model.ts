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

export interface IMembershipRequest {
  applicantName: string;
  email: string;
  phone?: string;
  imageUrl?: string;
  /** The applicant's survivor story; surfaced to admin reviewers. */
  survivorStory: string;

  /**
   * BD division code — `BDA` … `BDH`. Lines up with `BD_LOCATIONS` on the
   * FE so admin reviewers see the same labels the applicant picked.
   * Pre-fills the same field on the BA member doc when the application
   * is approved.
   */
  division?: string;
  /** District / zila label (free-text — the FE picks from a static list). */
  districtLabel?: string;
  /** Public-facing role string — applicant's preferred contribution
   *  (`Survivor Advocate`, `Legal Counsel`, `Community Organizer`, …). */
  roleLabel?: string;
  /** Short directory bio (1–2 sentences). Surfaces on the public `/members`
   *  card after approval. */
  bio?: string;

  status: MembershipRequestStatus;

  /** BA invitation id, set when status flips to `approved`. */
  invitationId?: string;
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
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    phone: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    survivorStory: { type: String, required: true, trim: true },
    division: { type: String, trim: true, index: true },
    districtLabel: { type: String, trim: true, index: true },
    roleLabel: { type: String, trim: true },
    bio: { type: String, trim: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    invitationId: { type: String },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
  },
  { timestamps: true },
);

// One pending application per email at a time. A rejected applicant can
// re-apply after admin clears or status is bumped.
membershipRequestSchema.index(
  { email: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);

const MembershipRequest: Model<IMembershipRequest> =
  (mongoose.models.MembershipRequest as Model<IMembershipRequest> | undefined) ??
  mongoose.model<IMembershipRequest>('MembershipRequest', membershipRequestSchema);

export default MembershipRequest;
