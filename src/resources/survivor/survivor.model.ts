/**
 * Survivor — the master record for a trafficking survivor / returnee migrant.
 *
 * This is the digital form of the paper **"Survivor Identification Registrar"**
 * (সারভাইভার চিহ্নিতকরণ রেজিস্টার). Registering a survivor IS the act of
 * identification — a foundation member captures the person once, and every
 * later interaction (counseling / referral / service) attaches to this record
 * via `SurvivorCase.survivorId` instead of re-typing the person's details.
 *
 * The shared "person block" (name, address, mobile, gender, country returned
 * from, return date) that the four paper survivor registrars all repeat lives
 * here exactly once.
 *
 * Ownership: `recordedBy` is the BA user id of the member who registered the
 * survivor — stamped server-side in the resource's `beforeCreate` hook. Members
 * only ever see / edit survivors they recorded; staff (admin / committee) see
 * all. See `shared/permissions.ts#ownedOrStaff`.
 */

import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema } = mongoose;

export type SurvivorGender = 'male' | 'female' | 'other';

export interface ISurvivor {
  _id: mongoose.Types.ObjectId;

  /**
   * Human-friendly handle (`ANB-SUR-2026-0001`). Auto-stamped on create by
   * mongokit's `customIdPlugin` + `dateSequentialId` (yearly partition) — see
   * `survivor.repository.ts`. Bound as the resource `idField` so URLs and the
   * FE cache key on this code rather than the raw ObjectId.
   */
  survivorId: string;

  /** Survivor's name (সারভাইভার নাম). */
  name: string;
  /** Address (ঠিকানা). */
  address?: string;
  /** Primary mobile number (মোবাইল নং). */
  mobile?: string;
  /** Gender (লিঙ্গ). */
  gender?: SurvivorGender;

  /** Country the survivor returned from (ফেরত দেশ). */
  countryReturnedFrom?: string;
  /** Date the survivor returned to the country (দেশে ফেরার তারিখ). */
  returnDate?: Date;

  /** Date the survivor was identified by the foundation (চিহ্নিত তারিখ). */
  identifiedDate?: Date;
  /** Free-text name of the person who identified the survivor
   *  (চিহ্নিতকরণ ব্যক্তি). Defaults to the recording member's name. */
  identifiedBy?: string;

  /** Free-form remarks. */
  remarks?: string;

  /** BA user id of the member who recorded this survivor (ownership key). */
  recordedBy?: string;
  /** Snapshot of the recorder's display name — survives user edits / lets the
   *  admin "who did what" view render without a join. */
  recordedByName?: string;

  /** Soft-delete tombstone (mongokit `softDeletePlugin`). */
  deletedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type SurvivorDocument = HydratedDocument<ISurvivor>;

const survivorSchema = new Schema<ISurvivor>(
  {
    survivorId: { type: String, required: true, unique: true, index: true },

    name: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    mobile: { type: String, trim: true, index: true },
    gender: { type: String, enum: ['male', 'female', 'other'], index: true },

    countryReturnedFrom: { type: String, trim: true, index: true },
    returnDate: { type: Date },

    identifiedDate: { type: Date },
    identifiedBy: { type: String, trim: true },

    remarks: { type: String, trim: true },

    recordedBy: { type: String, index: true },
    recordedByName: { type: String, trim: true },
  },
  { timestamps: true },
);

const Survivor: Model<ISurvivor> =
  (mongoose.models.Survivor as Model<ISurvivor> | undefined) ??
  mongoose.model<ISurvivor>('Survivor', survivorSchema);

export default Survivor;
