// =================================================================
// langchain-gns-aip — GNS Agent Identity Protocol for LangChain
//
// npm install langchain-gns-aip
//
// Three steps to compliance:
//   1. const id = await GNSAgentIdentity.provision({ ... });
//   2. await id.delegate(principalPk, { scope: {...} });
//   3. const agent = id.wrap(myLangChainAgent);
// =================================================================

export { GNSAgentIdentity } from './GNSAgentIdentity';
export type { GNSProvisionOptions, GNSDelegateOptions, GNSWrapOptions } from './GNSAgentIdentity';

export { GNSComplianceCallback } from './GNSComplianceCallback';
export type { GNSComplianceCallbackOptions, GNSAuditEvent } from './GNSComplianceCallback';

export { createGNSDelegationTool } from './GNSDelegationTool';
export type { DelegationCheckResult } from './GNSDelegationTool';
