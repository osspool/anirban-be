/**
 * App Plugins Registry
 *
 * Register your app-specific plugins here.
 * Dependencies are passed explicitly (no shims, no magic).
 */

import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/index.js';
import { openApiPlugin, scalarPlugin } from '@classytic/arc/docs';
import { errorHandlerPlugin } from '@classytic/arc/plugins';

/**
 * Register all app-specific plugins
 *
 * @param app - Fastify instance
 * @param deps - Explicit dependencies (config, services, etc.)
 */
export async function registerPlugins(
  app: FastifyInstance,
  deps: { config: AppConfig }
): Promise<void> {
  const { config } = deps;

  // Error handling (CastError → 400, validation → 422, duplicate → 409)
  await app.register(errorHandlerPlugin, {
    includeStack: config.isDev,
  });

  // API Documentation (Scalar UI)
  // OpenAPI spec: /_docs/openapi.json
  // Scalar UI: /docs
  await app.register(openApiPlugin, {
    title: 'anirban-be API',
    version: '1.0.0',
    description: 'API documentation for anirban-be',
    apiPrefix: '/api',
  });
  await app.register(scalarPlugin, {
    routePrefix: '/docs',
    theme: 'default',
  });

  // Add your custom plugins here:
  // await app.register(myCustomPlugin, { ...options });
}
