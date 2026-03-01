// =============================================================================
// GNS-AIP SDK — Sub-Delegation Chain Verification
// =============================================================================
// The Problem:
//   CrewAI Manager agent delegates to Researcher agent, which delegates to
//   Data Fetcher agent. When the Data Fetcher makes a request, who is the
//   principal? The EU AI Act says "a natural person" must be identifiable.
//
// The Solution:
//   A DelegationChain is an ordered array of DelegationCerts where:
//   - Chain[0]: Human → Agent A (root delegation, principalIdentity = human)
//   - Chain[1]: Agent A → Agent B (sub-delegation, Agent A signs as principal)
//   - Chain[N]: Agent N-1 → Agent N (leaf agent performing the operation)
//
//   Each link in the chain is a standard DelegationCert. The sub-delegation
//   rules are:
//   1. Each agent can only delegate if its cert has maxSubDelegationDepth > 0
//   2. The child cert's maxSubDelegationDepth = parent's depth - 1
//   3. The child cert's territory must be a SUBSET of the parent's
//   4. The child cert's facets must be a SUBSET of the parent's
//   5. The child cert's validity window must be WITHIN the parent's
//
//   Verification walks the chain from leaf to root, confirming every link
//   is valid and every constraint is respected. The root MUST have a human
//   identity (verified by the deployer's registration in the GNS network).
//
// Example (CrewAI multi-agent crew):
//   Human (physician)
//     └→ Manager Agent (maxSubDelegationDepth: 2)
//          ├→ Researcher Agent (maxSubDelegationDepth: 1)
//          │    └→ PubMed Fetcher Agent (maxSubDelegationDepth: 0) ← leaf
//          └→ Diagnostic Agent (maxSubDelegationDepth: 0) ← leaf
//
//   PubMed Fetcher's chain: [Human→Manager, Manager→Researcher, Researcher→Fetcher]
//   The chain cryptographically proves: Dr. Rossi authorized this data fetch.
// =============================================================================

import { DelegationCert, DelegationCertInput } from './types';
import {
  createDelegationCert,
  verifyDelegationCert,
  isDelegationActive,
} from './delegation';
import { isValidPublicKey } from './crypto';

// =============================================================================
// Sub-Delegation Creation
// =============================================================================

/**
 * Create a sub-delegation certificate from an existing delegation.
 *
 * The parent agent signs as the "principal" of the child cert.
 * Constraints are automatically enforced:
 * - Child territory ⊆ parent territory
 * - Child facets ⊆ parent facets
 * - Child depth = parent depth - 1
 * - Child validity ⊆ parent validity
 *
 * @param parentCert - The parent agent's delegation certificate
 * @param childAgentIdentity - Public key of the child agent
 * @param parentAgentSecretKey - Secret key of the parent agent (signs as principal)
 * @param options - Optional constraint overrides (can only narrow, not widen)
 * @returns Signed DelegationCert for the child agent
 */
export async function createSubDelegation(
  parentCert: DelegationCert,
  childAgentIdentity: string,
  parentAgentSecretKey: string,
  options?: {
    /** Subset of parent's territory cells (defaults to all parent cells) */
    territoryCells?: string[];
    /** Subset of parent's facet permissions (defaults to all parent facets) */
    facetPermissions?: string[];
    /** Custom validity start (must be >= parent's validFrom) */
    validFrom?: string;
    /** Custom validity end (must be <= parent's validUntil) */
    validUntil?: string;
  }
): Promise<DelegationCert> {
  // Validate parent can sub-delegate
  if (parentCert.maxSubDelegationDepth <= 0) {
    throw new Error(
      `Parent cert ${parentCert.certId} has maxSubDelegationDepth=0 — cannot sub-delegate`
    );
  }

  if (!isValidPublicKey(childAgentIdentity)) {
    throw new Error('Invalid child agent identity');
  }

  // Verify parent cert is still valid
  if (!verifyDelegationCert(parentCert)) {
    throw new Error('Parent delegation certificate has an invalid signature');
  }
  if (!isDelegationActive(parentCert)) {
    throw new Error('Parent delegation certificate is expired or not yet active');
  }

  // Territory: child must be subset of parent
  const childTerritory = options?.territoryCells || parentCert.territoryCells;
  const parentTerritorySet = new Set(parentCert.territoryCells);
  for (const cell of childTerritory) {
    if (!parentTerritorySet.has(cell)) {
      throw new Error(
        `Territory cell ${cell} is not in parent's jurisdiction — sub-delegation cannot widen territory`
      );
    }
  }

  // Facets: child must be subset of parent
  const childFacets = options?.facetPermissions || parentCert.facetPermissions;
  const parentFacetSet = new Set(parentCert.facetPermissions);
  for (const facet of childFacets) {
    if (!parentFacetSet.has(facet)) {
      throw new Error(
        `Facet '${facet}' is not in parent's permissions — sub-delegation cannot widen facets`
      );
    }
  }

  // Validity: child must be within parent's window
  const childFrom = options?.validFrom || parentCert.validFrom;
  const childUntil = options?.validUntil || parentCert.validUntil;
  if (new Date(childFrom) < new Date(parentCert.validFrom)) {
    throw new Error('Child validFrom cannot be before parent validFrom');
  }
  if (new Date(childUntil) > new Date(parentCert.validUntil)) {
    throw new Error('Child validUntil cannot be after parent validUntil');
  }

  // Build the sub-delegation cert
  const input: DelegationCertInput = {
    creatorIdentity: parentCert.creatorIdentity,
    deployerIdentity: parentCert.deployerIdentity,
    // The parent AGENT signs as principal (it IS the delegator now)
    principalIdentity: parentCert.agentIdentity,
    agentIdentity: childAgentIdentity,
    territoryCells: childTerritory,
    facetPermissions: childFacets,
    // Depth decrements by 1
    maxSubDelegationDepth: parentCert.maxSubDelegationDepth - 1,
    validFrom: childFrom,
    validUntil: childUntil,
  };

  return createDelegationCert(input, parentAgentSecretKey);
}

// =============================================================================
// Delegation Chain
// =============================================================================

/**
 * An ordered chain of delegation certificates from root (human) to leaf (agent).
 *
 * Chain[0] = root delegation (human → first agent)
 * Chain[N] = leaf delegation (last parent agent → leaf agent)
 */
export type DelegationChain = DelegationCert[];

/**
 * Build a delegation chain from a set of certificates.
 * Resolves the chain by following agentIdentity → principalIdentity links.
 *
 * @param leafCert - The leaf agent's delegation certificate
 * @param allCerts - All known delegation certificates in the system
 * @returns Ordered chain from root to leaf, or null if chain is broken
 */
export function buildDelegationChain(
  leafCert: DelegationCert,
  allCerts: DelegationCert[]
): DelegationChain | null {
  const chain: DelegationCert[] = [leafCert];
  let current = leafCert;

  // Walk backward: find the cert whose agentIdentity = current's principalIdentity
  const maxDepth = 10; // Safety limit
  for (let i = 0; i < maxDepth; i++) {
    // Find the cert that authorized the current principal
    const parent = allCerts.find(
      c => c.agentIdentity === current.principalIdentity && c.certHash !== current.certHash
    );
    if (!parent) break; // Reached root (principal is a human, not an agent with a cert)
    chain.unshift(parent);
    current = parent;
  }

  return chain;
}

// =============================================================================
// Chain Verification
// =============================================================================

/**
 * Verify an entire delegation chain from root to leaf.
 *
 * This is the critical function that answers: "Which human authorized
 * this AI action?" It verifies every link in the chain and confirms
 * that constraints narrow (never widen) at each hop.
 *
 * @param chain - Ordered delegation certificates [root, ..., leaf]
 * @param humanIdentities - Set of known human public keys (for root validation)
 * @returns Detailed verification result
 */
export function verifyDelegationChain(
  chain: DelegationChain,
  humanIdentities?: Set<string>
): ChainVerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (chain.length === 0) {
    return { valid: false, errors: ['Empty delegation chain'], warnings, depth: 0, rootPrincipal: '' };
  }

  const root = chain[0];
  const leaf = chain[chain.length - 1];

  // ── 1. Verify root is a human ──
  if (humanIdentities && humanIdentities.size > 0) {
    if (!humanIdentities.has(root.principalIdentity)) {
      errors.push(
        `Root principal ${root.principalIdentity.substring(0, 16)}... is not a recognized human identity`
      );
    }
  } else {
    warnings.push('No human identity set provided — cannot verify root is human');
  }

  // ── 2. Verify every cert's signature ──
  for (let i = 0; i < chain.length; i++) {
    const cert = chain[i];

    if (!verifyDelegationCert(cert)) {
      errors.push(`Chain[${i}] (${cert.certId}): invalid signature`);
    }

    if (!isDelegationActive(cert)) {
      errors.push(`Chain[${i}] (${cert.certId}): expired or not yet active`);
    }
  }

  // ── 3. Verify chain links (each cert's agentIdentity = next cert's principalIdentity) ──
  for (let i = 0; i < chain.length - 1; i++) {
    const parent = chain[i];
    const child = chain[i + 1];

    // Parent's agent must be child's principal
    if (parent.agentIdentity !== child.principalIdentity) {
      errors.push(
        `Chain break at [${i}]→[${i + 1}]: parent agent ${parent.agentIdentity.substring(0, 16)}... ≠ child principal ${child.principalIdentity.substring(0, 16)}...`
      );
    }

    // Sub-delegation depth must decrement
    if (parent.maxSubDelegationDepth <= 0) {
      errors.push(
        `Chain[${i}] has maxSubDelegationDepth=0 but delegated to chain[${i + 1}]`
      );
    } else if (child.maxSubDelegationDepth >= parent.maxSubDelegationDepth) {
      errors.push(
        `Chain[${i + 1}] depth (${child.maxSubDelegationDepth}) must be less than chain[${i}] depth (${parent.maxSubDelegationDepth})`
      );
    }

    // Territory must narrow (child ⊆ parent)
    const parentTerritorySet = new Set(parent.territoryCells);
    for (const cell of child.territoryCells) {
      if (!parentTerritorySet.has(cell)) {
        errors.push(
          `Chain[${i + 1}] territory cell ${cell} exceeds chain[${i}] territory scope`
        );
      }
    }

    // Facets must narrow (child ⊆ parent)
    const parentFacetSet = new Set(parent.facetPermissions);
    for (const facet of child.facetPermissions) {
      if (!parentFacetSet.has(facet)) {
        errors.push(
          `Chain[${i + 1}] facet '${facet}' exceeds chain[${i}] facet permissions`
        );
      }
    }

    // Validity window must be within parent's
    if (new Date(child.validFrom) < new Date(parent.validFrom)) {
      errors.push(
        `Chain[${i + 1}] validFrom is before chain[${i}] validFrom`
      );
    }
    if (new Date(child.validUntil) > new Date(parent.validUntil)) {
      errors.push(
        `Chain[${i + 1}] validUntil is after chain[${i}] validUntil`
      );
    }

    // Deployer must be consistent across chain
    if (child.deployerIdentity !== parent.deployerIdentity) {
      errors.push(
        `Chain[${i + 1}] deployer differs from chain[${i}] — all certs must share the same deployer`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    depth: chain.length,
    rootPrincipal: root.principalIdentity,
    leafAgent: leaf.agentIdentity,
    deployerIdentity: root.deployerIdentity,
  };
}

/**
 * Extract the human principal from a delegation chain.
 * This is the answer to "Which human authorized this action?"
 */
export function getRootPrincipal(chain: DelegationChain): string | null {
  if (chain.length === 0) return null;
  return chain[0].principalIdentity;
}

/**
 * Get the effective constraints for the leaf agent (intersection of all chain constraints).
 */
export function getEffectiveConstraints(chain: DelegationChain): EffectiveConstraints | null {
  if (chain.length === 0) return null;

  // Start with the root's constraints and narrow
  let territoryCells = new Set(chain[0].territoryCells);
  let facetPermissions = new Set(chain[0].facetPermissions);
  let validFrom = new Date(chain[0].validFrom);
  let validUntil = new Date(chain[0].validUntil);

  for (let i = 1; i < chain.length; i++) {
    const cert = chain[i];

    // Intersect territory
    const childTerritory = new Set(cert.territoryCells);
    territoryCells = new Set([...territoryCells].filter(c => childTerritory.has(c)));

    // Intersect facets
    const childFacets = new Set(cert.facetPermissions);
    facetPermissions = new Set([...facetPermissions].filter(f => childFacets.has(f)));

    // Narrow validity window
    const certFrom = new Date(cert.validFrom);
    const certUntil = new Date(cert.validUntil);
    if (certFrom > validFrom) validFrom = certFrom;
    if (certUntil < validUntil) validUntil = certUntil;
  }

  return {
    territoryCells: Array.from(territoryCells),
    facetPermissions: Array.from(facetPermissions),
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    maxSubDelegationDepth: chain[chain.length - 1].maxSubDelegationDepth,
    chainDepth: chain.length,
    rootPrincipal: chain[0].principalIdentity,
    leafAgent: chain[chain.length - 1].agentIdentity,
  };
}

// =============================================================================
// Types
// =============================================================================

export interface ChainVerificationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  depth: number;
  rootPrincipal: string;
  leafAgent?: string;
  deployerIdentity?: string;
}

export interface EffectiveConstraints {
  territoryCells: string[];
  facetPermissions: string[];
  validFrom: string;
  validUntil: string;
  maxSubDelegationDepth: number;
  chainDepth: number;
  rootPrincipal: string;
  leafAgent: string;
}
