/**
 * Resources Registry — anirban-be (mirrors be-prod's pattern).
 *
 * Two paths into the same registry:
 *
 *   - **Production / dev** (default): `app.ts` calls `createApp(...)`
 *     with `resourceDir: import.meta.url`. arc's `loadResources` walks
 *     the filesystem, dynamic-imports every `*.resource.ts`, runs each
 *     module's top-level await against the BA / mongoose context (which
 *     is up by the resources phase), and registers every default export.
 *
 *   - **Tests (vitest)**: vitest's tsx loader can't follow nested
 *     `.js`→`.ts` resolution through dynamic `import()`, so
 *     `loadResources` discovers the files but every import fails.
 *     Bypass discovery by passing `STATIC_RESOURCES` explicitly to the
 *     app factory — per arc's contract, "explicit `resources` wins
 *     over `resourceDir`." See `tests/helpers/lifecycle.ts`.
 *
 * The static imports below ALSO satisfy any consumer that reads from
 * this module directly (e.g. an OpenAPI generator script that wants the
 * full registry without booting Fastify).
 */

import type { ResourceDefinition } from '@classytic/arc';
import awarenessActivityResource from './awareness-activity/awareness-activity.resource.js';
import chapterResource from './chapter/chapter.resource.js';
import cmsResource from './cms/cms.resource.js';
import mediaResource from './media/media.resource.js';
import memberResource from './member/member.resource.js';
import membershipRequestResource from './membership-request/membership-request.resource.js';
import serviceProviderResource from './service-provider/service-provider.resource.js';
import supportRequestResource from './support-request/support-request.resource.js';
import survivorResource from './survivor/survivor.resource.js';
import survivorCaseResource from './survivor-case/survivor-case.resource.js';

/** Test-friendly static array — bypasses `loadResources` discovery. */
export const STATIC_RESOURCES: ReadonlyArray<ResourceDefinition<unknown>> = [
  chapterResource,
  cmsResource,
  mediaResource,
  memberResource,
  membershipRequestResource,
  supportRequestResource,
  // ── MIS / casework ──
  survivorResource,
  survivorCaseResource,
  serviceProviderResource,
  awarenessActivityResource,
];
