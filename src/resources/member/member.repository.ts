/**
 * Member Repository — plain mongokit repo over the `Member` model.
 *
 * Soft-delete enabled so removing a directory entry preserves the audit
 * trail (admins can restore mis-deletes). All domain logic lives in the
 * resource layer; this file is just the persistence binding.
 */

import { Repository, methodRegistryPlugin, softDeletePlugin } from '@classytic/mongokit';
import Member, { type IMember } from './member.model.js';

class MemberRepository extends Repository<IMember> {
  constructor() {
    super(Member, [methodRegistryPlugin(), softDeletePlugin()]);
  }
}

const memberRepository = new MemberRepository();
export default memberRepository;
export { MemberRepository };
