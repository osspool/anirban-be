import { Repository, methodRegistryPlugin } from '@classytic/mongokit';
import CmsPage, { type CmsPageDocument, type ICmsPage, type ITranslation } from './cms.model.js';

class CmsRepository extends Repository<ICmsPage> {
  constructor() {
    // `idField: 'slug'` MUST be set on the Repository (not just on the
    // arc resource) — otherwise Repository.delete() builds `{ _id: slug }`
    // and 404s because slug can't cast to ObjectId. Repository's CRUD
    // primitives switch to `findOneAndDelete({ slug: id })` once they
    // know the idField.
    //
    // No soft-delete plugin: this app uses hard delete throughout. CMS
    // editors revert by archiving (status: 'archived'), not deleting.
    super(CmsPage, [methodRegistryPlugin()], {}, { idField: 'slug' });
  }

  /**
   * Returns locale-resolved content for a published page.
   * Fallback chain: requested → defaultLocale → 'en' → first available.
   */
  async getPublished(
    slug: string,
    locale: string,
  ): Promise<{ slug: string; locale: string; metadata: ICmsPage['metadata']; data: unknown } | null> {
    const doc = await CmsPage.findOne({ slug, status: 'published' }).lean();
    if (!doc) return null;

    const chain = [...new Set([locale, doc.defaultLocale, 'en'])];
    let translation: ITranslation | undefined;
    for (const l of chain) {
      translation = doc.translations.find((t) => t.locale === l);
      if (translation) break;
    }
    if (!translation) translation = doc.translations[0];

    return {
      slug: doc.slug,
      locale: translation?.locale ?? locale,
      metadata: doc.metadata,
      data: translation?.data ?? {},
    };
  }

  /**
   * Upserts a locale translation on the page.
   * Creates the page document if the slug does not exist.
   * Also applies optional page-level updates (status, defaultLocale, metadata).
   */
  async upsertLocale(
    slug: string,
    locale: string,
    data: unknown,
    pageUpdates: Partial<Pick<ICmsPage, 'status' | 'defaultLocale' | 'metadata'>> = {},
  ): Promise<CmsPageDocument> {
    let page = await CmsPage.findOne({ slug });

    if (!page) {
      return CmsPage.create({
        slug,
        defaultLocale: pageUpdates.defaultLocale ?? 'en',
        status: pageUpdates.status ?? 'draft',
        ...(pageUpdates.metadata && { metadata: pageUpdates.metadata }),
        ...(pageUpdates.status === 'published' && { publishedAt: new Date() }),
        translations: [{ locale, data }],
      }) as Promise<CmsPageDocument>;
    }

    if (pageUpdates.status) {
      if (pageUpdates.status === 'published' && !page.publishedAt) {
        page.publishedAt = new Date();
      }
      page.status = pageUpdates.status;
    }
    if (pageUpdates.defaultLocale) page.defaultLocale = pageUpdates.defaultLocale;
    if (pageUpdates.metadata) page.metadata = pageUpdates.metadata;

    const idx = page.translations.findIndex((t) => t.locale === locale);
    if (idx >= 0) {
      page.translations[idx].data = data;
    } else {
      page.translations.push({ locale, data });
    }
    // Mixed subdoc requires explicit dirty-marking so Mongoose detects the change.
    page.markModified('translations');

    return page.save() as Promise<CmsPageDocument>;
  }
}

const cmsRepository = new CmsRepository();
export default cmsRepository;
export { CmsRepository };
