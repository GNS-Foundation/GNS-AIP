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
} from './types';

export {
  GNS_AIP_VERSION,
  GNS_AIP_PROTOCOL_VERSION,
  GNS_CONSTANTS,
  TIER_THRESHOLDS,
  AGENT_FACETS,
} from './types';

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
} from './crypto';

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
} from './h3';

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
} from './delegation';
export type { DelegationValidationResult } from './delegation';

// === Virtual Breadcrumbs (Proof-of-Jurisdiction) ===
export {
  createVirtualBreadcrumb,
  verifyBreadcrumb,
  verifyBreadcrumbChain,
  chainStatistics,
} from './breadcrumb';
export type { ChainVerificationResult, ChainStats } from './breadcrumb';

// === Compliance Score (TierGate) ===
export {
  calculateComplianceScore,
  determineTier,
  isTierSufficientForFacet,
  nextTierProgress,
} from './compliance';
export type { TierProgress } from './compliance';

// === Agent Manifest ===
export {
  createAgentManifest,
  signManifest,
  verifyManifest,
  updateManifestCompliance,
} from './manifest';

// === Human-in-the-Loop Escalation ===
export {
  EscalationTracker,
  createEscalationTracker,
  DEFAULT_ESCALATION_POLICIES,
} from './escalation';
export type {
  EscalationPolicy,
  EscalationRequired,
  EscalationReason,
  EscalationTrackerState,
} from './escalation';

// === Sub-Delegation Chain ===
export {
  createSubDelegation,
  buildDelegationChain,
  verifyDelegationChain,
  getRootPrincipal,
  getEffectiveConstraints,
} from './delegation-chain';
export type {
  DelegationChain,
  ChainVerificationResult as DelegationChainVerificationResult,
  EffectiveConstraints,
} from './delegation-chain';

// === MCP Middleware ===
export {
  MCPMiddleware,
  MCPGateError,
  createMCPMiddleware,
} from './mcp';
export type {
  MCPMiddlewareConfig,
  MCPRequestContext,
  MCPRejectCode,
  MCPAuthEvent,
  MCPRejectEvent,
  MCPVerifyResult,
} from './mcp';
