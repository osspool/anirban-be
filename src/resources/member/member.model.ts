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
export type MemberTeam = 'executive_committee' | 'chapter_committee' | 'advisory_board';

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

  /** Team affiliation — drives the public `/team` page. Unset on members
   *  who aren't part of a leadership team (still on `/members`, not on `/team`). */
  team?: MemberTeam;
  teamPosition?: string;
  /** Sort order within a team (lower wins; ties → displayName ASC). */
  teamRank?: number;

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
      enum: ['executive_committee', 'chapter_committee', 'advisory_board'],
      index: true,
    },
    teamPosition: { type: String, trim: true },
    teamRank: { type: Number },
  },
  { timestamps: true },
);

const Member: Model<IMember> =
  (mongoose.models.Member as Model<IMember> | undefined) ??
  mongoose.model<IMember>('Member', memberSchema);

export default Member;
