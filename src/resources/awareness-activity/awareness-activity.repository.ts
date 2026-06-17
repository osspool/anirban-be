/**
 * AwarenessActivity Repository — `ANB-ACT-2026-0001` handles + soft delete.
 */

import {
  Repository,
  customIdPlugin,
  dateSequentialId,
  methodRegistryPlugin,
  softDeletePlugin,
} from '@classytic/mongokit';
import AwarenessActivity, { type IAwarenessActivity } from './awareness-activity.model.js';

class AwarenessActivityRepository extends Repository<IAwarenessActivity> {
  constructor() {
    super(AwarenessActivity, [
      methodRegistryPlugin(),
      customIdPlugin({
        field: 'activityId',
        generator: dateSequentialId({
          prefix: 'ANB-ACT',
          model: AwarenessActivity,
          partition: 'yearly',
          padding: 4,
          separator: '-',
        }),
      }),
      softDeletePlugin(),
    ]);
  }
}

const awarenessActivityRepository = new AwarenessActivityRepository();
export default awarenessActivityRepository;
export { AwarenessActivityRepository };
