/**
 * SupportRequest Repository
 *
 * Plain mongokit repo with two plugins beyond the defaults:
 *
 *   - `customIdPlugin` — stamps every new doc with a human-friendly
 *     `reportId` like `ANB-2026-0001`. Uses `dateSequentialId` with
 *     `partition: 'yearly'` so the counter resets every January and IDs
 *     stay short. Backed by mongokit's atomic counters collection
 *     (`_mongokit_counters`) — safe under concurrent submissions.
 *   - `softDeletePlugin` — old/abusive submissions can be archived
 *     without breaking the timeline audit trail.
 *
 * State transition logic lives in the resource's `actions`, not here.
 */

import {
  Repository,
  customIdPlugin,
  dateSequentialId,
  methodRegistryPlugin,
  softDeletePlugin,
} from '@classytic/mongokit';
import SupportRequest, { type ISupportRequest } from './support-request.model.js';

class SupportRequestRepository extends Repository<ISupportRequest> {
  constructor() {
    super(SupportRequest, [
      methodRegistryPlugin(),
      // `ANB-2026-0001`, `ANB-2026-0002`, ... resets each January.
      // Padding 4 keeps IDs compact for the year's expected volume.
      customIdPlugin({
        field: 'reportId',
        generator: dateSequentialId({
          prefix: 'ANB',
          model: SupportRequest,
          partition: 'yearly',
          padding: 4,
          separator: '-',
        }),
      }),
      softDeletePlugin(),
    ]);
  }
}

const supportRequestRepository = new SupportRequestRepository();
export default supportRequestRepository;
export { SupportRequestRepository };
