/**
 * Media Engine — @classytic/media-kit singleton.
 *
 * Boots once per app lifecycle. The engine owns the Mongoose Media model
 * and exposes the repository as the domain API surface.
 *
 * Why these choices:
 *
 *  - **Cloudinary driver** — managed image CDN with on-the-fly resizing
 *    (`?w=200,c_fill`). Free tier (25 credits / month ≈ 25 GB storage +
 *    bandwidth) is comfortably large for a directory-style site.
 *
 *  - **Hard-coded provider folder `anirban`** — the Cloudinary account is
 *    SHARED across multiple client projects. Every upload is namespaced
 *    under `anirban/<logical-folder>/<file>` so we never collide with
 *    sibling projects' assets and a `cloudinary search folder=anirban`
 *    cleanly enumerates this app's footprint.
 *
 *  - **`processing.enabled: false`** — we don't generate derivative
 *    variants (thumbnails etc) the way a product catalog would. Cloudinary
 *    already serves transformed URLs on demand; storing pre-rendered
 *    variants would double bytes and waste free-tier credits. Callers ask
 *    for a thumbnail by URL transform, not by uploading a separate file.
 *
 *  - **`multiTenant: false`** — single-tenant app, no per-org scoping.
 *    media-kit's tenant filtering is skipped so the upload pipeline
 *    doesn't require an organizationId in the request context.
 */

import type { MediaEngine } from '@classytic/media-kit';
import { createMedia } from '@classytic/media-kit';
import { CloudinaryProvider } from '@classytic/media-kit/providers/cloudinary';
import mongoose from 'mongoose';

let engine: MediaEngine | null = null;
let pending: Promise<MediaEngine> | null = null;

export function ensureMediaEngine(): Promise<MediaEngine> {
  if (engine) return Promise.resolve(engine);
  if (pending) return pending;

  pending = (async () => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error(
        'Media engine: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must be set',
      );
    }

    engine = await createMedia({
      connection: mongoose.connection,
      driver: new CloudinaryProvider({
        cloudName,
        apiKey,
        apiSecret,
        // Account-wide folder prefix. Same Cloudinary account hosts other
        // client projects — keep their trees disjoint. Cloudinary prepends
        // this to every public_id, so a file uploaded with logical folder
        // `members/photo.jpg` lands at `anirban/members/<id>-photo`.
        folder: 'anirban',
      }),
      tenant: {
        tenantFieldType: 'string',
        multiTenant: false,
      },
      // Cloudinary serves resized variants from the URL — no point in
      // pre-rendering them on disk.
      processing: { enabled: false },
      // Explicit OFF. media-kit's default is already false (see
      // `media-kit/src/config.ts`), so the softDeletePlugin is never
      // attached. We pin it here so a future media-kit major bump
      // can't flip the default behind our back: every delete on this
      // resource MUST be a hard delete + driver-side cleanup, which is
      // what `MediaController.delete` (single) and `/bulk-delete`
      // (batch) already enforce. A soft-deleted row would mean the
      // Mongo doc lingers but the Cloudinary asset is still billable —
      // worst of both worlds.
      softDelete: { enabled: false },
      fileTypes: {
        allowed: [
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
          // PDF allowed because intake captures passport / ID scans.
          'application/pdf',
        ],
        maxSize: 32 * 1024 * 1024,
      },
    });

    return engine;
  })();

  return pending;
}

export function getMediaEngine(): MediaEngine {
  if (!engine) {
    throw new Error('Media engine not initialized — call ensureMediaEngine() first');
  }
  return engine;
}

export async function destroyMediaEngine(): Promise<void> {
  if (engine) {
    await engine.dispose();
    engine = null;
    pending = null;
  }
}
