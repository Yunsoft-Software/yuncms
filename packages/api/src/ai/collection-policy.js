import { restrictAccountabilityCollections } from '@yunsoft/yuncms-core';
import { serviceOptionsFromRequest } from '../service-options.js';

// The policy starts on the server, independently of all client chat fields.
export async function resolveAiCollectionRequest(req, emitter) {
  let policy = { denied_collections: [] };
  if (emitter) policy = await emitter.filter('ai.tools.policy', policy,
    { ...serviceOptionsFromRequest(req), services: req.context.services });
  try {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)
      || Object.keys(policy).some(key => key !== 'denied_collections')
      || !Object.hasOwn(policy, 'denied_collections')) throw new Error('Invalid policy envelope');
    const accountability = restrictAccountabilityCollections(req.accountability, policy.denied_collections);
    return { ...req, accountability };
  } catch {
    const error = new Error('The server AI collection policy is invalid');
    error.code = 'AI_COLLECTION_POLICY_INVALID';
    throw error;
  }
}
