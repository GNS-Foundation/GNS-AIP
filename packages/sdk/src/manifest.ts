// =============================================================================
// GNS-AIP SDK — Agent Manifest
// =============================================================================
// The agent's public identity document, published to the GNS network.
// Extends the GnsRecord pattern from gns_record.dart / records.ts.
//
// A manifest is what anyone resolving an agent's identity will see —
// including the Cloudflare Worker, the compliance dashboard, and auditors.
// =============================================================================

import {
  AgentManifest,
  SignedAgentManifest,
  AgentDomain,
  JurisdictionalScope,
  ComplianceTier,
  GNS_AIP_PROTOCOL_VERSION,
} from './types.js';
import {
  sign,
  verify,
  canonicalJson,
  isValidPublicKey,
} from './crypto.js';

// =============================================================================
// Manifest Creation
// =============================================================================

/**
 * Create a new agent manifest.
 *
 * @param params - Manifest parameters
 * @returns Unsigned AgentManifest
 */
export function createAgentManifest(params: {
  identity: string;
  domain: AgentDomain;
  name: string;
  description: string;
  deployerIdentity: string;
  deployerName: string;
  jurisdiction: JurisdictionalScope;
  facets: string[];
  handle?: string;
}): AgentManifest {
  if (!isValidPublicKey(params.identity)) {
    throw new Error('Invalid agent identity');
  }
  if (!isValidPublicKey(params.deployerIdentity)) {
    throw new Error('Invalid deployer identity');
  }

  const now = new Date().toISOString();

  return {
    version: GNS_AIP_PROTOCOL_VERSION,
    identity: params.identity,
    handle: params.handle,
    domain: params.domain,
    name: params.name,
    description: params.description,
    deployerIdentity: params.deployerIdentity,
    deployerName: params.deployerName,
    jurisdiction: params.jurisdiction,
    complianceScore: 0,
    complianceTier: 'provisioned',
    breadcrumbCount: 0,
    activeDelegations: [],
    facets: params.facets,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Sign a manifest for network publication.
 *
 * @param manifest - The manifest to sign
 * @param agentSecretKey - Agent's Ed25519 secret key (128 hex)
 * @returns SignedAgentManifest
 */
export function signManifest(
  manifest: AgentManifest,
  agentSecretKey: string
): SignedAgentManifest {
  const canonical = canonicalJson(manifest);
  const signature = sign(agentSecretKey, canonical);

  return {
    identity: manifest.identity,
    manifest,
    signature,
  };
}

/**
 * Verify a signed manifest's signature.
 */
export function verifyManifest(signed: SignedAgentManifest): boolean {
  const canonical = canonicalJson(signed.manifest);
  return verify(signed.identity, canonical, signed.signature);
}

/**
 * Update manifest with new compliance data.
 * Returns a new manifest (immutable pattern).
 */
export function updateManifestCompliance(
  manifest: AgentManifest,
  complianceScore: number,
  complianceTier: ComplianceTier,
  breadcrumbCount: number,
  activeDelegations: string[]
): AgentManifest {
  return {
    ...manifest,
    complianceScore,
    complianceTier,
    breadcrumbCount,
    activeDelegations,
    updatedAt: new Date().toISOString(),
  };
}
