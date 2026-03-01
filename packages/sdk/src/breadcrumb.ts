// =============================================================================
// GNS-AIP SDK — Virtual Breadcrumbs (Agent Audit Trail)
// =============================================================================
// Ported from: breadcrumb_block.dart + breadcrumb_engine.dart
//
// Human breadcrumbs prove "I was HERE" (Proof-of-Trajectory).
// Agent breadcrumbs prove "I operated WITHIN my jurisdiction" (Proof-of-Jurisdiction).
//
// Same hash-linked chain structure as human breadcrumbs:
//   Block N: hash(dataToSign + signature) → previousHash of Block N+1
// =============================================================================

import {
  VirtualBreadcrumb,
  VirtualBreadcrumbMeta,
  GNS_CONSTANTS,
} from './types';
import {
  sign,
  verify,
  canonicalJson,
  sha256Hex,
} from './crypto';
import { createContextDigest } from './h3';

// =============================================================================
// Breadcrumb Creation
// =============================================================================

/**
 * Create and sign a new virtual breadcrumb.
 *
 * Each breadcrumb records one agent operation in the Proof-of-Jurisdiction chain.
 *
 * @param params - Breadcrumb parameters
 * @param agentSecretKey - Agent's Ed25519 secret key (128 hex)
 * @param previousBreadcrumb - Previous breadcrumb in the chain (null for genesis)
 * @returns Signed VirtualBreadcrumb
 */
export async function createVirtualBreadcrumb(
  params: {
    agentIdentity: string;
    operationCell: string;
    meta: VirtualBreadcrumbMeta;
    timestamp?: Date;
  },
  agentSecretKey: string,
  previousBreadcrumb: VirtualBreadcrumb | null
): Promise<VirtualBreadcrumb> {
  const timestamp = params.timestamp || new Date();
  const index = previousBreadcrumb ? previousBreadcrumb.index + 1 : 0;
  const previousHash = previousBreadcrumb ? previousBreadcrumb.blockHash : null;

  // Create context digest (same pattern as h3_quantizer.dart)
  const contextDigest = await createContextDigest({
    h3Cell: params.operationCell,
    timestamp,
    operationType: params.meta.operationType,
    delegationCertHash: params.meta.delegationCertHash,
  });

  // Build the data object to sign (matches breadcrumb_block.dart dataToSign)
  const dataToSign = {
    index,
    identity: params.agentIdentity,
    timestamp: timestamp.toISOString(),
    loc_cell: params.operationCell,
    loc_res: GNS_CONSTANTS.AGENT_H3_RESOLUTION,
    context: contextDigest,
    prev_hash: previousHash ?? 'genesis',
    meta: {
      operationType: params.meta.operationType,
      delegationCertHash: params.meta.delegationCertHash,
      facet: params.meta.facet,
      withinTerritory: params.meta.withinTerritory,
      ...(params.meta.latencyMs !== undefined && { latencyMs: params.meta.latencyMs }),
      ...(params.meta.modelId && { modelId: params.meta.modelId }),
    },
  };

  // Sign the canonical JSON
  const canonical = canonicalJson(dataToSign);
  const signature = sign(agentSecretKey, canonical);

  // Compute block hash: sha256(dataToSign + signature)
  const blockHash = await sha256Hex(`${canonical}:${signature}`);

  return {
    index,
    agentIdentity: params.agentIdentity,
    timestamp: timestamp.toISOString(),
    operationCell: params.operationCell,
    cellResolution: GNS_CONSTANTS.AGENT_H3_RESOLUTION,
    contextDigest,
    previousHash,
    meta: params.meta,
    signature,
    blockHash,
  };
}

// =============================================================================
// Chain Verification
// =============================================================================

/**
 * Verify a single breadcrumb's signature.
 */
export function verifyBreadcrumb(breadcrumb: VirtualBreadcrumb): boolean {
  const dataToSign = {
    index: breadcrumb.index,
    identity: breadcrumb.agentIdentity,
    timestamp: breadcrumb.timestamp,
    loc_cell: breadcrumb.operationCell,
    loc_res: breadcrumb.cellResolution,
    context: breadcrumb.contextDigest,
    prev_hash: breadcrumb.previousHash ?? 'genesis',
    meta: {
      operationType: breadcrumb.meta.operationType,
      delegationCertHash: breadcrumb.meta.delegationCertHash,
      facet: breadcrumb.meta.facet,
      withinTerritory: breadcrumb.meta.withinTerritory,
      ...(breadcrumb.meta.latencyMs !== undefined && { latencyMs: breadcrumb.meta.latencyMs }),
      ...(breadcrumb.meta.modelId && { modelId: breadcrumb.meta.modelId }),
    },
  };

  return verify(breadcrumb.agentIdentity, canonicalJson(dataToSign), breadcrumb.signature);
}

/**
 * Verify a chain of breadcrumbs (hash links + signatures).
 *
 * Port of ChainStorage.verifyChain from chain_storage.dart.
 *
 * @param chain - Array of breadcrumbs in order (index 0 first)
 * @returns Verification result with details
 */
export function verifyBreadcrumbChain(chain: VirtualBreadcrumb[]): ChainVerificationResult {
  const issues: string[] = [];

  if (chain.length === 0) {
    return { valid: true, issues: [], verifiedCount: 0 };
  }

  // Genesis block must have no previous hash
  if (chain[0].previousHash !== null) {
    issues.push('Genesis block has non-null previousHash');
  }
  if (chain[0].index !== 0) {
    issues.push(`Genesis block has index ${chain[0].index}, expected 0`);
  }

  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];

    // Verify index is sequential
    if (block.index !== i) {
      issues.push(`Block ${i}: index is ${block.index}, expected ${i}`);
    }

    // Verify signature
    if (!verifyBreadcrumb(block)) {
      issues.push(`Block ${i}: invalid signature`);
    }

    // Verify hash chain link
    if (i > 0) {
      if (block.previousHash !== chain[i - 1].blockHash) {
        issues.push(`Block ${i}: previousHash doesn't match block ${i - 1} hash`);
      }
    }

    // Verify identity consistency (all blocks should be from same agent)
    if (block.agentIdentity !== chain[0].agentIdentity) {
      issues.push(`Block ${i}: agent identity mismatch`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    verifiedCount: chain.length,
  };
}

export interface ChainVerificationResult {
  valid: boolean;
  issues: string[];
  verifiedCount: number;
}

// =============================================================================
// Chain Statistics
// =============================================================================

/**
 * Compute statistics from a breadcrumb chain.
 * Used as input for the compliance score calculator.
 */
export function chainStatistics(chain: VirtualBreadcrumb[]): ChainStats {
  if (chain.length === 0) {
    return {
      totalOperations: 0,
      withinTerritoryOps: 0,
      territoryComplianceRate: 0,
      uniqueCells: 0,
      operationTypes: {},
      facets: {},
      firstTimestamp: null,
      lastTimestamp: null,
      daySpan: 0,
    };
  }

  const uniqueCells = new Set<string>();
  const operationTypes: Record<string, number> = {};
  const facets: Record<string, number> = {};
  let withinTerritoryOps = 0;

  for (const bc of chain) {
    uniqueCells.add(bc.operationCell);
    if (bc.meta.withinTerritory) withinTerritoryOps++;
    operationTypes[bc.meta.operationType] = (operationTypes[bc.meta.operationType] || 0) + 1;
    facets[bc.meta.facet] = (facets[bc.meta.facet] || 0) + 1;
  }

  const first = new Date(chain[0].timestamp);
  const last = new Date(chain[chain.length - 1].timestamp);
  const daySpan = Math.max(1, Math.ceil((last.getTime() - first.getTime()) / 86_400_000));

  return {
    totalOperations: chain.length,
    withinTerritoryOps,
    territoryComplianceRate: chain.length > 0 ? withinTerritoryOps / chain.length : 0,
    uniqueCells: uniqueCells.size,
    operationTypes,
    facets,
    firstTimestamp: chain[0].timestamp,
    lastTimestamp: chain[chain.length - 1].timestamp,
    daySpan,
  };
}

export interface ChainStats {
  totalOperations: number;
  withinTerritoryOps: number;
  territoryComplianceRate: number;
  uniqueCells: number;
  operationTypes: Record<string, number>;
  facets: Record<string, number>;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  daySpan: number;
}
