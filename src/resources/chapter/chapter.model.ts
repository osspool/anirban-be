/**
 * Chapter — a local Anirban chapter (e.g. "Khulna Chapter", "Cox's Bazar").
 *
 * Chapters are foundation-wide directory rows that members can be
 * associated with via `Member.chapterId`. A chapter is anchored to a BD
 * division (BDA…BDH) and optionally a specific district label so the
 * public marketing site can show "10 chapters across 8 divisions".
 *
 * Lightweight on purpose: this is metadata, not a workflow — admins
 * create / rename / archive (soft-delete) chapters and link members in
 * from the member sheet's dropdown.
 */

import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema } = mongoose;

export type ChapterStatus = 'active' | 'pending' | 'inactive';

export interface IChapter {
  _id: mongoose.Types.ObjectId;

  /** Public-facing chapter name (e.g. "Khulna Chapter"). */
  name: string;
  /** URL-safe handle for any future per-chapter public page. Optional —
   *  admins can leave it blank and we never auto-generate to keep the
   *  field deterministic across renames. */
  slug?: string;

  /** BD division code anchoring the chapter (BDA…BDH). */
  division?: string;
  /** Optional district label inside that division. */
  districtLabel?: string;

  /** 1–3 sentence summary surfaced on the public site. */
  description?: string;
  /** When the chapter was formally established. */
  foundedAt?: Date;

  status: ChapterStatus;

  /** Optional pointer to the lead member's `Member._id`. Display-only —
   *  not used for permission checks. */
  leadMemberId?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type ChapterDocument = HydratedDocument<IChapter>;

const chapterSchema = new Schema<IChapter>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, lowercase: true, index: true, sparse: true, unique: true },

    division: { type: String, trim: true, index: true },
    districtLabel: { type: String, trim: true },

    description: { type: String, trim: true },
    foundedAt: { type: Date },

    status: {
      type: String,
      enum: ['active', 'pending', 'inactive'],
      default: 'active',
      index: true,
    },

    leadMemberId: { type: String, trim: true, index: true, sparse: true },
  },
  { timestamps: true },
);

const Chapter: Model<IChapter> =
  (mongoose.models.Chapter as Model<IChapter> | undefined) ??
  mongoose.model<IChapter>('Chapter', chapterSchema);

export default Chapter;
