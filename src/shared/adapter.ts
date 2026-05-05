/**
 * MongoKit Adapter Factory
 *
 * Creates Arc adapters using MongoKit repositories.
 * The repository handles query parsing via MongoKit's built-in QueryParser.
 */

import { createMongooseAdapter } from '@classytic/mongokit/adapter';
import { buildCrudSchemasFromModel, type Repository } from '@classytic/mongokit';
import type { DataAdapter } from '@classytic/repo-core/adapter';
import type { Model } from 'mongoose';

/**
 * Create a MongoKit-powered adapter for a resource.
 *
 * Note: Query parsing is handled by MongoKit's Repository class.
 * `buildCrudSchemasFromModel` is the canonical OpenAPI schema generator
 * for arc + Mongoose (arc 2.12+ no longer ships a built-in fallback —
 * passing it explicitly is required for OpenAPI auto-generation).
 *
 * The explicit `DataAdapter<TDoc>` return annotation pins the type
 * portability — without it, `tsc --noEmit` reports non-portable inferred
 * paths when arc/repo-core are linked via `file:` protocol (nested
 * `@classytic/arc/node_modules/...` path leaks into `.d.ts` output).
 */
export function createAdapter<TDoc = unknown>(
  model: Model<TDoc>,
  repository: Repository<TDoc>,
): DataAdapter<TDoc> {
  return createMongooseAdapter({
    model,
    repository,
    schemaGenerator: buildCrudSchemasFromModel,
  }) as DataAdapter<TDoc>;
}
