import mongoose, { type HydratedDocument, type Model } from 'mongoose';

const { Schema } = mongoose;

export type CmsStatus = 'draft' | 'published' | 'archived';

export interface ITranslation {
  locale: string;
  data: unknown;
}

export interface ICmsPage {
  _id: mongoose.Types.ObjectId;
  slug: string;
  status: CmsStatus;
  defaultLocale: string;
  publishedAt?: Date;
  metadata?: {
    title?: string;
    description?: string;
    keywords?: string[];
    ogImage?: string;
  };
  translations: ITranslation[];
  createdAt: Date;
  updatedAt: Date;
}

export type CmsPageDocument = HydratedDocument<ICmsPage>;

const translationSchema = new Schema<ITranslation>(
  {
    locale: { type: String, required: true, trim: true, lowercase: true },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const metadataSchema = new Schema(
  {
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    keywords: [{ type: String, trim: true }],
    ogImage: { type: String, trim: true },
  },
  { _id: false },
);

const cmsPageSchema = new Schema<ICmsPage>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    defaultLocale: { type: String, default: 'en', trim: true, lowercase: true },
    publishedAt: { type: Date },
    metadata: { type: metadataSchema, required: false },
    translations: { type: [translationSchema], default: [] },
  },
  { timestamps: true },
);

const CmsPage: Model<ICmsPage> =
  (mongoose.models.CmsPage as Model<ICmsPage> | undefined) ??
  mongoose.model<ICmsPage>('CmsPage', cmsPageSchema);

export default CmsPage;
