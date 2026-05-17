import {
  BaseController,
  NotFoundError,
  type IControllerResponse,
  type IRequestContext,
} from '@classytic/arc';
import type { Repository } from '@classytic/mongokit';
import CmsPage, { type ICmsPage } from './cms.model.js';
import type { CmsRepository } from './cms.repository.js';

export class CmsController extends BaseController {
  readonly #cms: CmsRepository;

  constructor(repo: CmsRepository) {
    super(repo as unknown as Repository);
    this.#cms = repo;
  }

  /**
   * GET /cms/:slug
   *
   * With ?locale=<code>: returns locale-resolved content for published pages only.
   * Without locale param: returns the full document (all translations, any status)
   * — intended for the admin dashboard editor.
   */
  override async get(req: IRequestContext): Promise<IControllerResponse<Record<string, unknown>>> {
    const slug = req.params?.id as string;
    const locale = (req.query as Record<string, string | undefined>)?.locale;

    if (locale) {
      const result = await this.#cms.getPublished(slug, locale);
      if (!result) throw new NotFoundError('CmsPage');
      return { data: result };
    }

    const doc = await CmsPage.findOne({ slug });
    if (!doc) throw new NotFoundError('CmsPage');
    return { data: doc as unknown as Record<string, unknown> };
  }

  /**
   * PATCH /cms/:slug
   *
   * Body: { locale, data, status?, defaultLocale?, metadata? }
   *
   * Upserts the named locale translation on the page.
   * Creates the page document if the slug does not yet exist.
   */
  override async update(req: IRequestContext): Promise<IControllerResponse<Record<string, unknown>>> {
    const slug = req.params?.id as string;
    const body = req.body as {
      locale?: string;
      data?: unknown;
      status?: ICmsPage['status'];
      defaultLocale?: string;
      metadata?: ICmsPage['metadata'];
    };

    const doc = await this.#cms.upsertLocale(slug, body.locale ?? 'en', body.data ?? {}, {
      status: body.status,
      defaultLocale: body.defaultLocale,
      metadata: body.metadata,
    });

    return { data: doc as unknown as Record<string, unknown> };
  }
}
