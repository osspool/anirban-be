/**
 * MembershipRequest Repository
 *
 * Hard-delete only. The `status` field (`pending | approved | rejected`)
 * already encodes the lifecycle, so a deleted application is one the
 * admin actually wants gone — no soft-delete tombstone.
 */

import { Repository, methodRegistryPlugin } from '@classytic/mongokit';
import MembershipRequest, { type IMembershipRequest } from './membership-request.model.js';

class MembershipRequestRepository extends Repository<IMembershipRequest> {
  constructor() {
    super(MembershipRequest, [methodRegistryPlugin()]);
  }
}

const membershipRequestRepository = new MembershipRequestRepository();
export default membershipRequestRepository;
export { MembershipRequestRepository };
