/**
 * ServiceProvider Resource — admin-curated provider directory.
 *
 *   GET    /api/service-providers       — any signed-in member reads (to pick
 *                                         a provider when logging a case)
 *   GET    /api/service-providers/:id   — read one
 *   POST   /api/service-providers       — staff create
 *   PATCH  /api/service-providers/:id   — staff edit
 *   DELETE /api/service-providers/:id   — staff remove (hard — prefer
 *                                         `isActive: false` to retire)
 *
 * No ownership: this is shared reference data. Reads are open to all members
 * so the case form's provider picker works for everyone; writes are staff-only.
 */

import { defineResource } from '@classytic/arc';
import { requireAuth } from '@classytic/arc/permissions';
import { buildCrudSchemasFromModel, QueryParser } from '@classytic/mongokit';
import { createMongooseAdapter } from '@classytic/mongokit/adapter';
import { requireStaff } from '#shared/permissions.js';
import ServiceProvider, { type IServiceProvider } from './service-provider.model.js';
import serviceProviderRepository from './service-provider.repository.js';

const queryParser = new QueryParser({
  allowedFilterFields: ['categories', 'division', 'isActive'],
  searchMode: 'regex',
  searchFields: ['name', 'address', 'contactPerson', 'district'],
});

const serviceProviderResource = defineResource<IServiceProvider>({
  name: 'service-provider',
  prefix: '/service-providers',
  adapter: createMongooseAdapter({
    model: ServiceProvider,
    repository: serviceProviderRepository,
    schemaGenerator: buildCrudSchemasFromModel,
  }),
  queryParser,
  tenantField: false,

  permissions: {
    list: requireAuth(),
    get: requireAuth(),
    create: requireStaff(),
    update: requireStaff(),
    delete: requireStaff(),
  },

  schemaOptions: {
    fieldRules: {
      createdAt: { systemManaged: true },
      updatedAt: { systemManaged: true },
    },
  },
});

export default serviceProviderResource;
