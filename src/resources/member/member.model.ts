/**
 * Member — foundation directory entry.
 *
 * Plain mongoose model owned by the arc resource layer. Decoupled from
 * Better Auth's `organization.member` collection — see the rationale in
 * `member.resource.ts`. A directory entry can exist with or without a
 * linked BA user account; admins create login-capable members by also
 * provisioning a `user` (BA admin plugin's `createUser` or signup flow)
 * and storing the user's id in `userId`.
 *
 * Roles:
 *   admin             — foundation administrator (full surface)
 *   committee_member  — runs the support-request workflow
 *   general           — read-only directory entry / general member
 *
 * The role on this doc is purely informational for the directory listing
 * (drives the badge on /members + /team). Permission checks read the
 * AUTH role from the BA `user.role` (BA admin plugin), populated into
 * `request.scope.userRoles` by arc's auth adapter — see auth.config.ts.
 */

import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema } = mongoose;

export type MemberRole = 'admin' | 'committee_member' | 'general';
export type MemberStatus = 'founding' | 'active' | 'ambassador' | 'alumni';
/**
 * Foundation-level teams ONLY. Per-chapter leadership is encoded via
 * `chapterId` + `isChapterLead` — see those fields below. The old
 * `'chapter_committee'` enum value conflated "global team" with
 * "per-chapter role" and has been dropped.
 */
export type MemberTeam = 'executive_committee' | 'advisory_board';
export type MemberGender = 'male' | 'female';

export interface IMember {
  _id: mongoose.Types.ObjectId;

  /** Optional link to a BA `user` row. Unset for directory-only entries. */
  userId?: string;
  /** Optional contact email. Independent of BA — directory may carry an
   *  email even when there's no login account. Not unique on purpose:
   *  multiple entries can share an email (rare, but valid). */
  email?: string;

  /** Public display name. Falls back to BA user name when linked. */
  displayName?: string;
  imageUrl?: string;
  survivorStory?: string;
  phone?: string;
  joinedAt?: Date;
  isPubliclyListed: boolean;

  /** Self-reported gender. Optional — directory entries are not required
   *  to disclose. Persisted lowercase so filtering stays case-stable. */
  gender?: MemberGender;
  /** Age in years at the time the entry was created/last edited. Stored
   *  as a number rather than a DOB on purpose: many survivors don't have
   *  a documented birthdate and approximate age is the data we actually
   *  collect during intake. Range guarded at the schema level. */
  age?: number;
  /** FK to a `Chapter._id` — which local Anirban chapter the member is
   *  associated with. Optional: members can exist independent of any
   *  chapter (founding members, advisors, alumni). */
  chapterId?: string;

  /** BD division code: BDA / BDB / BDC / BDD / BDE / BDF / BDG / BDH. */
  division?: string;
  districtLabel?: string;
  /** Public-facing role string ("Survivor Advocate", "Legal Counsel", ...). */
  roleLabel?: string;
  /** Short directory bio (1–2 sentences). */
  bio?: string;
  /** Comma-separated tags ("Peer Support, Bengali"). FE splits client-side. */
  tags?: string;

  memberStatus: MemberStatus;

  /** Foundation role — informational on this doc; permission checks read
   *  from BA `user.role` for login-capable members. */
  role: MemberRole;

  /** Foundation-level team affiliation — drives the public `/team` page.
   *  Unset on members who aren't part of a foundation-wide leadership
   *  body (chapter leadership is encoded via `isChapterLead` instead). */
  team?: MemberTeam;
  teamPosition?: string;
  /** Sort order within a team OR a chapter — lower wins; ties → displayName ASC. */
  teamRank?: number;

  /** Marks the member as a chapter lead. Used by the public chapter
   *  page (`/chapters/:id`) to surface the lead at the top of the
   *  "top members" block. A member can be a chapter lead even if `team`
   *  is unset — chapter leadership is independent of foundation teams. */
  isChapterLead?: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type MemberDocument = HydratedDocument<IMember>;

const memberSchema = new Schema<IMember>(
  {
    userId: { type: String, trim: true, index: true, sparse: true },
    email: { type: String, trim: true, lowercase: true, index: true, sparse: true },

    displayName: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    survivorStory: { type: String, trim: true },
    phone: { type: String, trim: true },
    joinedAt: { type: Date },
    isPubliclyListed: { type: Boolean, default: true },

    gender: { type: String, enum: ['male', 'female'], index: true },
    age: { type: Number, min: 0, max: 150 },
    chapterId: { type: String, trim: true, index: true, sparse: true },

    division: { type: String, trim: true, index: true },
    districtLabel: { type: String, trim: true },
    roleLabel: { type: String, trim: true },
    bio: { type: String, trim: true },
    tags: { type: String, trim: true },

    memberStatus: {
      type: String,
      enum: ['founding', 'active', 'ambassador', 'alumni'],
      default: 'active',
      index: true,
    },

    role: {
      type: String,
      enum: ['admin', 'committee_member', 'general'],
      default: 'general',
      index: true,
    },

    team: {
      type: String,
      enum: ['executive_committee', 'advisory_board'],
      index: true,
    },
    teamPosition: { type: String, trim: true },
    teamRank: { type: Number },
    isChapterLead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

const Member: Model<IMember> =
  (mongoose.models.Member as Model<IMember> | undefined) ??
  mongoose.model<IMember>('Member', memberSchema);

export default Member;
