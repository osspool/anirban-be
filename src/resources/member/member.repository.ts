/**
 * Member Repository — plain mongokit repo over the `Member` model.
 *
 * Hard-delete only. No `softDeletePlugin`: when an admin removes a member,
 * the row is physically deleted from MongoDB. Auditing happens through
 * `mongoose-timeline-audit` on entities that need it; the Member doc is
 * directory metadata, not a workflow, so retaining deleted rows would
 * just clutter the collection.
 */

import { Repository, methodRegistryPlugin } from '@classytic/mongokit';
import Member, { type IMember } from './member.model.js';

class MemberRepository extends Repository<IMember> {
  constructor() {
    super(Member, [methodRegistryPlugin()]);
  }
}

const memberRepository = new MemberRepository();
export default memberRepository;
export { MemberRepository };
