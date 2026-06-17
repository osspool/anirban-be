/**
 * AwarenessActivity — a community awareness event against trafficking and
 * child marriage. Digital form of the paper
 * **"মানবপাচার ও বাল্যবিবাহ প্রতিরোধে সচেতনতামূলক কার্যক্রম রেজিস্টার"**.
 *
 * Standalone (not tied to a survivor). A member logs the activity they ran;
 * `recordedBy` attributes it for the admin "who did what" view.
 *
 * Columns → fields:
 *   কার্যক্রম নাম/ধরণ → name | স্থান → location | তারিখ → date
 *   মোট অংশগ্রহণকারী → totalParticipants | নারী → womenCount | পুরুষ → menCount
 *   কার্যক্রম পরিচালনাকারী ব্যক্তি → conductedBy
 */

import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema } = mongoose;

export interface IAwarenessActivity {
  _id: mongoose.Types.ObjectId;

  /** Friendly handle (`ANB-ACT-2026-0001`). Bound as `idField`. */
  activityId: string;

  /** Activity name / type. */
  name: string;
  /** Where it was held. */
  location?: string;
  /** When it was held. */
  date?: Date;

  /** Total participants. */
  totalParticipants?: number;
  /** Women among participants. */
  womenCount?: number;
  /** Men among participants. */
  menCount?: number;

  /** Free-text name of the person who ran the activity. */
  conductedBy?: string;

  notes?: string;

  /** Ownership key — member who recorded the activity. */
  recordedBy?: string;
  recordedByName?: string;

  deletedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type AwarenessActivityDocument = HydratedDocument<IAwarenessActivity>;

const awarenessActivitySchema = new Schema<IAwarenessActivity>(
  {
    activityId: { type: String, required: true, unique: true, index: true },

    name: { type: String, required: true, trim: true },
    location: { type: String, trim: true },
    date: { type: Date },

    totalParticipants: { type: Number, min: 0 },
    womenCount: { type: Number, min: 0 },
    menCount: { type: Number, min: 0 },

    conductedBy: { type: String, trim: true },

    notes: { type: String, trim: true },

    recordedBy: { type: String, index: true },
    recordedByName: { type: String, trim: true },
  },
  { timestamps: true },
);

const AwarenessActivity: Model<IAwarenessActivity> =
  (mongoose.models.AwarenessActivity as Model<IAwarenessActivity> | undefined) ??
  mongoose.model<IAwarenessActivity>('AwarenessActivity', awarenessActivitySchema);

export default AwarenessActivity;
