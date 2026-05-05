/**
 * Arc Presets - Single-Tenant Configuration
 *
 * Pre-configured presets for single-tenant applications.
 */

import {
  ownedByUserPreset,
  softDeletePreset,
  slugLookupPreset,
} from '@classytic/arc/presets';

/**
 * Owned by creator preset
 * Filters queries by createdBy field.
 */
export const ownedByCreator = ownedByUserPreset({
  ownerField: 'createdBy',
});

/**
 * Owned by user preset
 * For resources where userId references the owner.
 */
export const ownedByUser = ownedByUserPreset({
  ownerField: 'userId',
});

/**
 * Soft delete preset
 * Adds deletedAt filtering and restore endpoint.
 */
export const softDelete = softDeletePreset();

/**
 * Slug lookup preset
 * Enables GET by slug in addition to ID.
 */
export const slugLookup = slugLookupPreset();

// Export all presets
export const presets = {
  ownedByCreator,
  ownedByUser,
  softDelete,
  slugLookup,
} as const;

export default presets;
