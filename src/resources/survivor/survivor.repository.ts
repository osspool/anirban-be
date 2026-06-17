/**
 * Survivor Repository
 *
 * mongokit repo over the `Survivor` model with three plugins:
 *
 *   - `customIdPlugin` — stamps `survivorId` (`ANB-SUR-2026-0001`) via an
 *     atomic counter (`_mongokit_counters`), yearly partition so the sequence
 *     resets each January. Safe under concurrent registrations.
 *   - `softDeletePlugin` — survivor records carry case history that attaches
 *     by `survivorId`; an accidental member delete must be recoverable. This
 *     plugin filters `deletedAt` out of normal reads and powers the
 *     `softDelete` preset's `/deleted` + `/:id/restore` routes.
 *   - `methodRegistryPlugin` — standard mongokit method registry.
 */

import {
  Repository,
  customIdPlugin,
  dateSequentialId,
  methodRegistryPlugin,
  softDeletePlugin,
} from '@classytic/mongokit';
import Survivor, { type ISurvivor } from './survivor.model.js';

class SurvivorRepository extends Repository<ISurvivor> {
  constructor() {
    super(Survivor, [
      methodRegistryPlugin(),
      customIdPlugin({
        field: 'survivorId',
        generator: dateSequentialId({
          prefix: 'ANB-SUR',
          model: Survivor,
          partition: 'yearly',
          padding: 4,
          separator: '-',
        }),
      }),
      softDeletePlugin(),
    ]);
  }
}

const survivorRepository = new SurvivorRepository();
export default survivorRepository;
export { SurvivorRepository };
