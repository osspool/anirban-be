/**
 * MembershipRequest Repository
 *
 * Plain mongokit repo — soft-delete is enabled in case admins want to
 * archive old applications without losing the audit trail. Domain logic
 * (approve/reject) lives in the resource's `actions`, not here.
 */

import { Repository, methodRegistryPlugin, softDeletePlugin } from '@classytic/mongokit';
import MembershipRequest, { type IMembershipRequest } from './membership-request.model.js';

class MembershipRequestRepository extends Repository<IMembershipRequest> {
  constructor() {
    super(MembershipRequest, [methodRegistryPlugin(), softDeletePlugin()]);
  }
}

const membershipRequestRepository = new MembershipRequestRepository();
export default membershipRequestRepository;
export { MembershipRequestRepository };
