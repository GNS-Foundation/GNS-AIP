// =============================================================================
// @gns-aip/sdk — GNS Agent Identity Protocol
// =============================================================================
//
// The identity layer the internet never had — for AI agents.
//
// Quick start:
//
//   import { generateAgentIdentity, createDelegationCert, createVirtualBreadcrumb } from '@gns-aip/sdk';
//
//   // 1. Provision: create agent identity (Ed25519 keypair)
//   const agent = generateAgentIdentity();
//
//   // 2. Delegate: human principal authorizes the agent
//   const cert = await createDelegationCert({
//     deployerIdentity: deployer.publicKey,
//     principalIdentity: human.publicKey,
//     agentIdentity: agent.publicKey,
//     territoryCells: jurisdiction.cells,
//     facetPermissions: ['health'],
//   }, human.secretKey);
//
//   // 3. Operate: agent records auditable breadcrumbs
//   const breadcrumb = await createVirtualBreadcrumb({
//     agentIdentity: agent.publicKey,
//     operationCell: jurisdiction.cells[0],
//     meta: {
//       operationType: 'inference',
//       delegationCertHash: cert.certHash,
//       facet: 'health',
//       withinTerritory: true,
//     },
//   }, agent.secretKey, null);
//
// =============================================================================

// === Types ===
export type {
  AgentIdentity,
  AgentIdentityPublic,
  AgentDomain,
  JurisdictionalScope,
  DelegationCert,
  DelegationCertInput,
  VirtualBreadcrumb,
  VirtualBreadcrumbMeta,
  OperationContext,
  ComplianceScore,
  ComplianceTier,
  AgentManifest,
  SignedAgentManifest,
  AgentFacetConfig,
  ProvisionRequest,
  ProvisionResponse,
  DelegateRequest,
  AIPDelegationHeader,
} from './types.js';

export {
  GNS_AIP_VERSION,
  GNS_AIP_PROTOCOL_VERSION,
  GNS_CONSTANTS,
  TIER_THRESHOLDS,
  AGENT_FACETS,
} from './types.js';

// === Crypto (keypair generation, signing, verification) ===
export {
  generateAgentIdentity,
  agentIdentityFromSecretKey,
  agentIdentityFromSeed,
  toPublicIdentity,
  sign,
  signCanonical,
  verify,
  verifyCanonical,
  canonicalJson,
  sha256,
  sha256Hex,
  hexToBytes,
  bytesToHex,
  isValidPublicKey,
  isValidSignature,
  generateNonce,
  generateId,
  ed25519ToStellarAddress,
  stellarAddressToPublicKey,
} from './crypto.js';

// === H3 Territorial Binding ===
export {
  latLngToH3,
  h3ToLatLng,
  getParentCell,
  getNeighbors,
  getCellAreaKm2,
  isValidH3Cell,
  createJurisdiction,
  createJurisdictionFromCenter,
  createEUJurisdiction,
  createSwitzerlandJurisdiction,
  isWithinJurisdiction,
  isTrajectoryPlausible,
  createContextDigest,
} from './h3.js';

// === Delegation Certificates ===
export {
  createDelegationCert,
  verifyDelegationCert,
  isDelegationActive,
  isDelegationAuthorizedForCell,
  isDelegationAuthorizedForFacet,
  validateDelegation,
  serializeDelegationHeader,
  parseDelegationHeader,
} from './delegation.js';
export type { DelegationValidationResult } from './delegation.js';

// === Virtual Breadcrumbs (Proof-of-Jurisdiction) ===
export {
  createVirtualBreadcrumb,
  verifyBreadcrumb,
  verifyBreadcrumbChain,
  chainStatistics,
} from './breadcrumb.js';
export type { ChainVerificationResult, ChainStats } from './breadcrumb.js';

// === Compliance Score (TierGate) ===
export {
  calculateComplianceScore,
  determineTier,
  isTierSufficientForFacet,
  nextTierProgress,
} from './compliance.js';
export type { TierProgress } from './compliance.js';

// === Agent Manifest ===
export {
  createAgentManifest,
  signManifest,
  verifyManifest,
  updateManifestCompliance,
} from './manifest.js';

// === Human-in-the-Loop Escalation ===
export {
  EscalationTracker,
  createEscalationTracker,
  DEFAULT_ESCALATION_POLICIES,
} from './escalation.js';
export type {
  EscalationPolicy,
  EscalationRequired,
  EscalationReason,
  EscalationTrackerState,
} from './escalation.js';

// === MCP Middleware ===
export {
  MCPMiddleware,
  MCPGateError,
  createMCPMiddleware,
} from './mcp.js';
export type {
  MCPMiddlewareConfig,
  MCPRequestContext,
  MCPRejectCode,
  MCPAuthEvent,
  MCPRejectEvent,
  MCPVerifyResult,
} from './mcp.js';

// === Sub-Delegation Chain (Functional API) ===
export {
  createSubDelegation,
  buildDelegationChain,
  verifyDelegationChain,
  getRootPrincipal,
  getEffectiveConstraints,
} from './sub-delegation.js';
export type {
  ChainVerificationResult as SubDelegationChainResult,
  EffectiveConstraints,
} from './sub-delegation.js';

// === Barrel re-exports ===
export * from './delegation-chain.js';
export * from './hitl.js';
export * from './oidc.js';
