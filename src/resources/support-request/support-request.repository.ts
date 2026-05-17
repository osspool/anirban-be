/**
 * SupportRequest Repository
 *
 * Plain mongokit repo with one plugin beyond the defaults:
 *
 *   - `customIdPlugin` — stamps every new doc with a human-friendly
 *     `reportId` like `ANB-2026-0001`. Uses `dateSequentialId` with
 *     `partition: 'yearly'` so the counter resets every January and IDs
 *     stay short. Backed by mongokit's atomic counters collection
 *     (`_mongokit_counters`) — safe under concurrent submissions.
 *
 * Hard-delete only. The `status` field already encodes case lifecycle
 * (`pending → in_review → resolved | closed`); a deleted report is one
 * the admin wants gone for real (spam, duplicates). The `timeline[]`
 * audit lives on the doc, so deleting the doc deletes its audit — that
 * is the intended semantics.
 */

import {
  Repository,
  customIdPlugin,
  dateSequentialId,
  methodRegistryPlugin,
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
    ]);
  }
}

const supportRequestRepository = new SupportRequestRepository();
export default supportRequestRepository;
export { SupportRequestRepository };
