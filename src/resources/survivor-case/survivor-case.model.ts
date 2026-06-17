/**
 * SurvivorCase — a single interaction logged against a Survivor.
 *
 * Collapses THREE paper registrars into one CRUD via a `type` discriminator:
 *
 *   - `counseling` → সারভাইভার কাউন্সেলিং রেজিস্টার
 *       counselorName (কাউন্সেলর), sessionCount (সেশন সংখ্যা),
 *       serviceProviderId (কাউন্সেলিং স্থান)
 *   - `referral`   → সারভাইভার রেফারেশ রেজিস্টার
 *       serviceProviderId (রেফারেল প্রতিষ্ঠান), referralSubject (রেফারেল বিষয়)
 *   - `service`    → সারভাইভার সার্ভিস রেজিস্টার
 *       serviceType (সার্ভিসের ধরণ), serviceProviderId (সার্ভিস প্রদান প্রতিষ্ঠান),
 *       referredByPerson (রেফারেল ব্যক্তি)
 *
 * The person block (name / address / mobile / …) is NOT repeated here — it
 * lives on the parent `Survivor` (`survivorId`). Type-specific fields are all
 * optional at the schema level; the FE form makes the right ones required per
 * `type` via formkit `condition`.
 */

import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema } = mongoose;

export type SurvivorCaseType = 'counseling' | 'referral' | 'service';

export interface ISurvivorCase {
  _id: mongoose.Types.ObjectId;

  /** Friendly handle (`ANB-CASE-2026-0001`). Bound as `idField`. */
  caseId: string;

  /** Parent survivor's `survivorId` (`ANB-SUR-…`). */
  survivorId: string;
  /** Which registrar this row represents. */
  type: SurvivorCaseType;
  /** Date of the interaction (counseling / referral / service date). */
  date?: Date;

  /**
   * Optional pointer to a `ServiceProvider._id` — the counseling office (for
   * counseling), the referral institution (for referral), or the service
   * provider organisation (for service). Picked from the admin-curated
   * directory so a member routes the survivor to a known office.
   */
  serviceProviderId?: string;
  /** Snapshot of the provider name at log time (renders without a join). */
  serviceProviderName?: string;

  // ── counseling ──
  counselorName?: string;
  sessionCount?: number;

  // ── referral ──
  referralSubject?: string;

  // ── service ──
  serviceType?: string;
  referredByPerson?: string;

  notes?: string;

  /** Ownership key — BA user id of the member who logged the case. */
  recordedBy?: string;
  recordedByName?: string;

  deletedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type SurvivorCaseDocument = HydratedDocument<ISurvivorCase>;

const survivorCaseSchema = new Schema<ISurvivorCase>(
  {
    caseId: { type: String, required: true, unique: true, index: true },

    survivorId: { type: String, required: true, trim: true, index: true },
    type: {
      type: String,
      enum: ['counseling', 'referral', 'service'],
      required: true,
      index: true,
    },
    date: { type: Date },

    serviceProviderId: { type: String, trim: true, index: true },
    serviceProviderName: { type: String, trim: true },

    counselorName: { type: String, trim: true },
    sessionCount: { type: Number, min: 0 },

    referralSubject: { type: String, trim: true },

    serviceType: { type: String, trim: true },
    referredByPerson: { type: String, trim: true },

    notes: { type: String, trim: true },

    recordedBy: { type: String, index: true },
    recordedByName: { type: String, trim: true },
  },
  { timestamps: true },
);

const SurvivorCase: Model<ISurvivorCase> =
  (mongoose.models.SurvivorCase as Model<ISurvivorCase> | undefined) ??
  mongoose.model<ISurvivorCase>('SurvivorCase', survivorCaseSchema);

export default SurvivorCase;
