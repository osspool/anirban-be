/**
 * ServiceProvider Repository — plain mongokit repo. No custom-id (small,
 * admin-curated directory), no soft delete (`isActive: false` retires a
 * provider while preserving historic case links).
 */

import { Repository, methodRegistryPlugin } from '@classytic/mongokit';
import ServiceProvider, { type IServiceProvider } from './service-provider.model.js';

class ServiceProviderRepository extends Repository<IServiceProvider> {
  constructor() {
    super(ServiceProvider, [methodRegistryPlugin()]);
  }
}

const serviceProviderRepository = new ServiceProviderRepository();
export default serviceProviderRepository;
export { ServiceProviderRepository };
