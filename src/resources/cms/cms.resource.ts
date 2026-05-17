/**
 * CMS Resource — slug-keyed, multi-locale content pages.
 *
 * Endpoint surface:
 *
 *   GET    /api/cms                        — admin list all pages
 *   GET    /api/cms/:slug                  — full doc, all translations (admin editor)
 *   GET    /api/cms/:slug?locale=<code>    — locale-resolved content (public / FE)
 *   POST   /api/cms                        — admin create page shell
 *   PATCH  /api/cms/:slug                  — admin upsert locale translation (creates if absent)
 *   DELETE /api/cms/:slug                  — admin soft-delete
 *
 * Frontend owns page structure and default values; the backend stores
 * raw JSON per locale inside translations[]. The fallback chain
 * (requested → defaultLocale → 'en' → first available) lives in the repo.
 */

import { defineResource } from '@classytic/arc';
import { allowPublic } from '@classytic/arc/permissions';
import { buildCrudSchemasFromModel, QueryParser } from '@classytic/mongokit';
import { createMongooseAdapter } from '@classytic/mongokit/adapter';
import { requireAdmin } from '#shared/permissions.js';
import CmsPage, { type ICmsPage } from './cms.model.js';
import cmsRepository from './cms.repository.js';
import { CmsController } from './cms.controller.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['status', 'defaultLocale'],
  searchFields: ['slug'],
});

const controller = new CmsController(cmsRepository);

const cmsResource = defineResource<ICmsPage>({
  name: 'cms',
  prefix: '/cms',
  adapter: createMongooseAdapter({
    model: CmsPage,
    repository: cmsRepository,
    schemaGenerator: buildCrudSchemasFromModel,
  }),
  controller,
  queryParser,
  tenantField: false,
  idField: 'slug',
  // No soft-delete preset: mongokit's `actions/delete.ts` hardcodes
  // `findByIdAndUpdate(id)` which ignores `idField`. DELETE by slug would
  // 404 even when the row exists. Hard delete is fine for CMS rows —
  // editors revert by archiving (status='archived') anyway, and the
  // dictionary fallback keeps the page rendering.

  permissions: {
    list: requireAdmin(),
    get: allowPublic(),
    create: requireAdmin(),
    update: requireAdmin(),
    delete: requireAdmin(),
  },

  schemaOptions: {
    fieldRules: {
      publishedAt: { systemManaged: true },
      createdAt: { systemManaged: true },
      updatedAt: { systemManaged: true },
    },
  },
});

export default cmsResource;
