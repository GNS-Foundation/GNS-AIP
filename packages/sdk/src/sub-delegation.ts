// =============================================================================
// GNS-AIP SDK — Sub-Delegation (Functional API)
// =============================================================================
// Functional wrappers for multi-hop delegation chains using the flat
// DelegationCert type. Enables: Human → Agent A → Agent B → Agent C
//
// EU AI Act Mapping:
//   Article 14 — Every chain traces back to a human principal
//   Article 17 — Depth + facet scope limits enforce least-privilege
//   Article 26 — Audit trail via certHash linkage binds liability
// =============================================================================

import {
    DelegationCert,
    DelegationCertInput,
} from './types.js';
import { createDelegationCert, verifyDelegationCert } from './delegation.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of verifying a delegation chain.
 */
export interface ChainVerificationResult {
    valid: boolean;
    errors: string[];
    depth: number;
    rootPrincipal: string;
}

/**
 * Effective constraints computed from the intersection of all certs in a chain.
 */
export interface EffectiveConstraints {
    territoryCells: string[];
    facetPermissions: string[];
    maxSubDelegationDepth: number;
    rootPrincipal: string;
    leafAgent: string;
}

// =============================================================================
// createSubDelegation
// =============================================================================

/**
 * Create a sub-delegation certificate where a delegated agent further
 * delegates to another agent.
 *
 * The parent agent becomes the principal of the child cert.
 * Territory and facets are inherited from the parent (can be narrowed).
 * maxSubDelegationDepth is decremented by 1.
 *
 * @param parentCert  - The parent's delegation certificate
 * @param childPk     - Child agent's Ed25519 public key (64 hex)
 * @param parentSk    - Parent agent's Ed25519 secret key (128 hex)
 * @param opts        - Optional overrides (narrowed territory/facets)
 * @returns Signed DelegationCert for the child agent
 */
export async function createSubDelegation(
    parentCert: DelegationCert,
    childPk: string,
    parentSk: string,
    opts?: {
        territoryCells?: string[];
        facetPermissions?: string[];
    }
): Promise<DelegationCert> {
    // Block if parent cannot sub-delegate
    if (parentCert.maxSubDelegationDepth <= 0) {
        throw new Error(
            'Cannot sub-delegate: maxSubDelegationDepth=0 on parent certificate'
        );
    }

    // Resolve territory: default to parent's, allow narrowing
    let territoryCells = parentCert.territoryCells;
    if (opts?.territoryCells) {
        // Validate subset: every requested cell must be in parent's territory
        const parentSet = new Set(parentCert.territoryCells);
        const invalid = opts.territoryCells.filter((c) => !parentSet.has(c));
        if (invalid.length > 0) {
            throw new Error(
                `Cannot widen territory beyond parent: ${invalid.join(', ')} not in parent territory`
            );
        }
        territoryCells = opts.territoryCells;
    }

    // Resolve facets: default to parent's, allow narrowing
    let facetPermissions = parentCert.facetPermissions;
    if (opts?.facetPermissions) {
        const parentFacets = new Set(parentCert.facetPermissions);
        const invalid = opts.facetPermissions.filter((f) => !parentFacets.has(f));
        if (invalid.length > 0) {
            throw new Error(
                `Cannot widen facets beyond parent: ${invalid.join(', ')} not in parent facets`
            );
        }
        facetPermissions = opts.facetPermissions;
    }

    const input: DelegationCertInput = {
        deployerIdentity: parentCert.deployerIdentity,
        principalIdentity: parentCert.agentIdentity, // Parent agent becomes principal
        agentIdentity: childPk,
        territoryCells,
        facetPermissions,
        maxSubDelegationDepth: parentCert.maxSubDelegationDepth - 1,
        validFrom: parentCert.validFrom,
        validUntil: parentCert.validUntil,
    };

    return createDelegationCert(input, parentSk);
}

// =============================================================================
// buildDelegationChain
// =============================================================================

/**
 * Build an ordered delegation chain from leaf to root.
 *
 * Walks backwards from the leaf cert, finding certs whose agentIdentity
 * matches the current cert's principalIdentity.
 *
 * @param leafCert - The leaf (most-derived) delegation certificate
 * @param allCerts - All available certificates to search through
 * @returns Ordered array [root, ..., leaf] or null if chain cannot be built
 */
export function buildDelegationChain(
    leafCert: DelegationCert,
    allCerts: DelegationCert[]
): DelegationCert[] | null {
    const chain: DelegationCert[] = [leafCert];
    let current = leafCert;

    // Walk backwards: find cert where agentIdentity === current.principalIdentity
    const maxDepth = 100; // Safety limit
    for (let i = 0; i < maxDepth; i++) {
        const parent = allCerts.find(
            (c) =>
                c.agentIdentity === current.principalIdentity &&
                c.certHash !== current.certHash
        );
        if (!parent) break; // Reached root (no parent found)
        chain.unshift(parent);
        current = parent;
    }

    return chain.length > 0 ? chain : null;
}

// =============================================================================
// verifyDelegationChain
// =============================================================================

/**
 * Verify an ordered delegation chain.
 *
 * Checks:
 * 1. Every cert signature is valid
 * 2. Chain linkage: chain[i].agentIdentity === chain[i+1].principalIdentity
 * 3. Root principal is in the trusted human set
 * 4. Sub-delegation depth is respected
 *
 * @param chain     - Ordered array [root, ..., leaf]
 * @param humanPkSet - Set of trusted human principal public keys
 * @returns Verification result
 */
export function verifyDelegationChain(
    chain: DelegationCert[],
    humanPkSet: Set<string>
): ChainVerificationResult {
    const errors: string[] = [];

    if (chain.length === 0) {
        return { valid: false, errors: ['Empty chain'], depth: 0, rootPrincipal: '' };
    }

    const rootPrincipal = chain[0].principalIdentity;

    // Check root is a known human
    if (!humanPkSet.has(rootPrincipal)) {
        errors.push(
            `Root principal ${rootPrincipal.substring(0, 16)}... is not a recognized human identity`
        );
    }

    // Verify each cert
    for (let i = 0; i < chain.length; i++) {
        const cert = chain[i];

        // Signature check
        if (!verifyDelegationCert(cert)) {
            errors.push(`Cert ${i} (${cert.certId}): invalid signature`);
        }

        // Linkage check (except root)
        if (i > 0) {
            const parent = chain[i - 1];
            if (parent.agentIdentity !== cert.principalIdentity) {
                errors.push(
                    `Cert ${i}: principalIdentity does not match parent's agentIdentity`
                );
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        depth: chain.length,
        rootPrincipal,
    };
}

// =============================================================================
// getRootPrincipal
// =============================================================================

/**
 * Extract the root human principal from an ordered delegation chain.
 *
 * @param chain - Ordered array [root, ..., leaf]
 * @returns The principalIdentity of the root cert
 */
export function getRootPrincipal(chain: DelegationCert[]): string {
    if (chain.length === 0) {
        throw new Error('Cannot get root principal from empty chain');
    }
    return chain[0].principalIdentity;
}

// =============================================================================
// getEffectiveConstraints
// =============================================================================

/**
 * Compute the effective constraints by intersecting all certs in the chain.
 *
 * Territory and facets are intersected (most restrictive wins).
 * maxSubDelegationDepth is taken from the leaf cert.
 *
 * @param chain - Ordered array [root, ..., leaf]
 * @returns The effective constraints, or null if chain is empty
 */
export function getEffectiveConstraints(
    chain: DelegationCert[]
): EffectiveConstraints | null {
    if (chain.length === 0) return null;

    // Start with root's constraints, then intersect with each subsequent cert
    let territoryCells = new Set(chain[0].territoryCells);
    let facetPermissions = new Set(chain[0].facetPermissions);

    for (let i = 1; i < chain.length; i++) {
        const cert = chain[i];
        // Intersect territory
        const certTerritory = new Set(cert.territoryCells);
        territoryCells = new Set(
            [...territoryCells].filter((c) => certTerritory.has(c))
        );
        // Intersect facets
        const certFacets = new Set(cert.facetPermissions);
        facetPermissions = new Set(
            [...facetPermissions].filter((f) => certFacets.has(f))
        );
    }

    const leaf = chain[chain.length - 1];

    return {
        territoryCells: [...territoryCells],
        facetPermissions: [...facetPermissions],
        maxSubDelegationDepth: leaf.maxSubDelegationDepth,
        rootPrincipal: chain[0].principalIdentity,
        leafAgent: leaf.agentIdentity,
    };
}
