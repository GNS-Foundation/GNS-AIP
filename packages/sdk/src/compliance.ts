// =============================================================================
// GNS-AIP SDK — Compliance Score Calculator (TierGate)
// =============================================================================
// Mirrors the human trust score from breadcrumb_engine.dart:
//   - Humans: trust built through physical movement (breadcrumb count + diversity)
//   - Agents: trust built through compliant operations (within-territory rate + volume)
//
// Tier progression:
//   Provisioned → Observed → Trusted → Certified → Sovereign
//   0 ops         50+ ops    500+ ops   5K+ ops     50K+ ops
//   0%            25%        60%        85%         99%
// =============================================================================

import {
  ComplianceScore,
  ComplianceTier,
  TIER_THRESHOLDS,
} from './types.js';
import { ChainStats } from './breadcrumb.js';

/**
 * Calculate the compliance score for an AI agent based on its breadcrumb chain stats.
 *
 * Score composition (100% total):
 *   40% — Territory compliance rate (within-territory operations / total)
 *   25% — Operation volume (max at 5,000 operations)
 *   15% — Cell diversity (unique operational cells, max at 50)
 *   10% — Temporal continuity (days since provisioning, max at 180)
 *   10% — Chain integrity (valid = 10%, invalid = 0%)
 *
 * This mirrors the human trust score formula from breadcrumb_engine.dart:
 *   40% breadcrumb count, 30% unique locations, 20% continuity, 10% chain integrity
 * Adjusted for agents: territory compliance replaces location diversity as primary signal.
 *
 * @param stats - Chain statistics from chainStatistics()
 * @param chainValid - Whether the breadcrumb chain passes integrity verification
 * @param provisionedAt - ISO 8601 timestamp of agent provisioning
 * @returns Computed ComplianceScore
 */
export function calculateComplianceScore(
  stats: ChainStats,
  chainValid: boolean,
  provisionedAt: string
): ComplianceScore {
  // === 40%: Territory compliance rate ===
  const territoryScore = stats.territoryComplianceRate * 40;

  // === 25%: Operation volume (max at 5,000) ===
  const volumeScore = Math.min(stats.totalOperations / 5000, 1.0) * 25;

  // === 15%: Cell diversity (max at 50 unique cells) ===
  const diversityScore = Math.min(stats.uniqueCells / 50, 1.0) * 15;

  // === 10%: Temporal continuity (max at 180 days) ===
  const daysSinceProvisioning = Math.max(1, Math.ceil(
    (Date.now() - new Date(provisionedAt).getTime()) / 86_400_000
  ));
  const continuityScore = Math.min(daysSinceProvisioning / 180, 1.0) * 10;

  // === 10%: Chain integrity ===
  const integrityScore = chainValid ? 10 : 0;

  // Total score (0-100)
  const score = Math.min(100, Math.round(
    (territoryScore + volumeScore + diversityScore + continuityScore + integrityScore) * 100
  ) / 100);

  // Determine tier
  const tier = determineTier(stats.totalOperations, score);

  // Violation count = out-of-territory operations
  const violationCount = stats.totalOperations - stats.withinTerritoryOps;

  return {
    tier,
    score,
    totalOperations: stats.totalOperations,
    withinTerritoryOps: stats.withinTerritoryOps,
    territoryComplianceRate: stats.territoryComplianceRate,
    violationCount,
    uniqueCells: stats.uniqueCells,
    daysSinceProvisioning,
    chainValid,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Determine the compliance tier based on operations count and score.
 * An agent must meet BOTH thresholds to advance to a tier.
 */
export function determineTier(totalOps: number, score: number): ComplianceTier {
  const tiers: ComplianceTier[] = ['sovereign', 'certified', 'trusted', 'observed', 'provisioned'];
  for (const tier of tiers) {
    const threshold = TIER_THRESHOLDS[tier];
    if (totalOps >= threshold.minOps && score >= threshold.minScore) {
      return tier;
    }
  }
  return 'provisioned';
}

/**
 * Check if an agent's compliance tier allows a specific facet.
 */
export function isTierSufficientForFacet(
  agentTier: ComplianceTier,
  requiredTier: ComplianceTier
): boolean {
  const tierOrder: ComplianceTier[] = [
    'provisioned', 'observed', 'trusted', 'certified', 'sovereign',
  ];
  return tierOrder.indexOf(agentTier) >= tierOrder.indexOf(requiredTier);
}

/**
 * Get the next tier and what's needed to reach it.
 */
export function nextTierProgress(score: ComplianceScore): TierProgress | null {
  const tierOrder: ComplianceTier[] = [
    'provisioned', 'observed', 'trusted', 'certified', 'sovereign',
  ];
  const currentIdx = tierOrder.indexOf(score.tier);
  if (currentIdx >= tierOrder.length - 1) return null; // Already sovereign

  const nextTier = tierOrder[currentIdx + 1];
  const threshold = TIER_THRESHOLDS[nextTier];

  return {
    nextTier,
    opsNeeded: Math.max(0, threshold.minOps - score.totalOperations),
    scoreNeeded: Math.max(0, threshold.minScore - score.score),
    opsProgress: Math.min(1, score.totalOperations / threshold.minOps),
    scoreProgress: Math.min(1, score.score / threshold.minScore),
  };
}

export interface TierProgress {
  nextTier: ComplianceTier;
  opsNeeded: number;
  scoreNeeded: number;
  opsProgress: number;
  scoreProgress: number;
}
