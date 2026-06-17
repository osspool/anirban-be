/**
 * SurvivorCase Repository — `ANB-CASE-2026-0001` handles + soft delete.
 */

import {
  Repository,
  customIdPlugin,
  dateSequentialId,
  methodRegistryPlugin,
  softDeletePlugin,
} from '@classytic/mongokit';
import SurvivorCase, { type ISurvivorCase } from './survivor-case.model.js';

class SurvivorCaseRepository extends Repository<ISurvivorCase> {
  constructor() {
    super(SurvivorCase, [
      methodRegistryPlugin(),
      customIdPlugin({
        field: 'caseId',
        generator: dateSequentialId({
          prefix: 'ANB-CASE',
          model: SurvivorCase,
          partition: 'yearly',
          padding: 4,
          separator: '-',
        }),
      }),
      softDeletePlugin(),
    ]);
  }
}

const survivorCaseRepository = new SurvivorCaseRepository();
export default survivorCaseRepository;
export { SurvivorCaseRepository };
