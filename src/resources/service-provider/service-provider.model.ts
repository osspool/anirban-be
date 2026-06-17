/**
 * ServiceProvider — directory of counseling offices, referral institutions
 * and service-providing organisations.
 *
 * Admin-curated, foundation-wide (no ownership). When a member logs a
 * SurvivorCase they pick the relevant office from this list, so referrals
 * route to known, vetted providers instead of free-text. `isActive` lets an
 * admin retire an office without deleting historic links to it.
 */

import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema } = mongoose;

/** What a provider offers — drives the picker filter on the case form. */
export type ServiceCategory =
  | 'counseling'
  | 'legal'
  | 'medical'
  | 'shelter'
  | 'livelihood'
  | 'other';

export interface IServiceProvider {
  _id: mongoose.Types.ObjectId;

  name: string;
  /** One provider can offer several categories. */
  categories: ServiceCategory[];

  address?: string;
  division?: string;
  district?: string;

  contactPerson?: string;
  phone?: string;
  email?: string;

  /** Retired providers stay in the DB (for historic case links) but drop out
   *  of the active picker. */
  isActive: boolean;

  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type ServiceProviderDocument = HydratedDocument<IServiceProvider>;

const serviceProviderSchema = new Schema<IServiceProvider>(
  {
    name: { type: String, required: true, trim: true },
    categories: {
      type: [String],
      enum: ['counseling', 'legal', 'medical', 'shelter', 'livelihood', 'other'],
      default: [],
      index: true,
    },

    address: { type: String, trim: true },
    division: { type: String, trim: true, index: true },
    district: { type: String, trim: true },

    contactPerson: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },

    isActive: { type: Boolean, default: true, index: true },

    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

const ServiceProvider: Model<IServiceProvider> =
  (mongoose.models.ServiceProvider as Model<IServiceProvider> | undefined) ??
  mongoose.model<IServiceProvider>('ServiceProvider', serviceProviderSchema);

export default ServiceProvider;
