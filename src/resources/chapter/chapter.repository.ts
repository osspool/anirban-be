/**
 * Chapter Repository — plain mongokit repo over the `Chapter` model.
 *
 * Hard-delete only. Chapters are directory metadata; archiving via
 * `status: 'inactive'` covers the "deactivate without deleting" flow
 * cleanly without a soft-delete tombstone.
 */

import { Repository, methodRegistryPlugin } from '@classytic/mongokit';
import Chapter, { type IChapter } from './chapter.model.js';

class ChapterRepository extends Repository<IChapter> {
  constructor() {
    super(Chapter, [methodRegistryPlugin()]);
  }
}

const chapterRepository = new ChapterRepository();
export default chapterRepository;
export { ChapterRepository };
