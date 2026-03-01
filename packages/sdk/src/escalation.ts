// =============================================================================
// GNS-AIP SDK — Human-in-the-Loop Escalation
// =============================================================================
// EU AI Act, Article 14: "High-risk AI systems shall be designed and developed
// in such a way [...] that they can be effectively overseen by natural persons."
//
// The Problem (Delegation Drift):
//   A human signs a DelegationCert on Monday. The agent runs 10,000 financial
//   transactions over the next 30 days. The human's intent may have changed
//   on Tuesday, but the cert is still valid. The agent is operating on
//   stale authorization.
//
// The Solution (Escalation Policy):
//   High-risk facets define escalation rules that force the agent to pause
//   and request fresh human authorization at defined intervals:
//   - Every N operations (e.g., every 100 financial transactions)
//   - Every T hours (e.g., every 24 hours for health data processing)
//   - On specific triggers (e.g., amount > threshold, new territory cell)
//
//   When an escalation triggers, the agent MUST obtain a fresh DelegationCert
//   before continuing. The old cert remains valid but insufficient — the
//   escalation policy requires a newer timestamp.
//
// This is the cryptographic enforcement of "human oversight proportional
// to risk" that the EU AI Act requires.
// =============================================================================

import { DelegationCert } from './types';
import { isDelegationActive, verifyDelegationCert } from './delegation';

// =============================================================================
// Escalation Policy Definition
// =============================================================================

/**
 * Defines when an agent must escalate to a human for fresh authorization.
 *
 * Each facet can have its own policy. The policy is enforced client-side
 * by the SDK — the agent framework (LangChain, CrewAI) checks before
 * each operation whether escalation is needed.
 */
export interface EscalationPolicy {
  /** Facet this policy applies to */
  facet: string;
  /** Maximum operations before requiring fresh delegation (null = no limit) */
  maxOpsPerCert: number | null;
  /** Maximum hours before cert is considered "stale" (null = use cert expiry) */
  maxHoursPerCert: number | null;
  /** Operation types that always require fresh delegation */
  alwaysEscalateOps: string[];
  /** Whether entering a new H3 cell requires re-authorization */
  escalateOnNewTerritory: boolean;
  /** Human-readable description of the policy rationale */
  rationale: string;
}

// =============================================================================
// Default Escalation Policies Per Facet
// =============================================================================

/**
 * Pre-configured escalation policies aligned with regulatory requirements.
 *
 * These are defaults — deployers can customize per-agent, but cannot
 * WEAKEN them (only strengthen). A finance agent can require re-auth
 * every 50 ops instead of 100, but never every 200.
 */
export const DEFAULT_ESCALATION_POLICIES: Record<string, EscalationPolicy> = {
  health: {
    facet: 'health',
    maxOpsPerCert: 200,
    maxHoursPerCert: 24,
    alwaysEscalateOps: ['diagnosis', 'prescription', 'treatment_plan', 'pii_export'],
    escalateOnNewTerritory: true,
    rationale: 'GDPR Article 22 + EU AI Act: automated health decisions require periodic human oversight',
  },
  finance: {
    facet: 'finance',
    maxOpsPerCert: 100,
    maxHoursPerCert: 8,
    alwaysEscalateOps: ['trade_execute', 'fund_transfer', 'credit_decision', 'kyc_override'],
    escalateOnNewTerritory: true,
    rationale: 'FINMA + MiFID II: financial transactions require frequent human authorization',
  },
  legal: {
    facet: 'legal',
    maxOpsPerCert: 500,
    maxHoursPerCert: 48,
    alwaysEscalateOps: ['contract_sign', 'legal_filing', 'settlement_offer'],
    escalateOnNewTerritory: true,
    rationale: 'Legal actions carry irreversible consequences requiring human judgment',
  },
  creator: {
    facet: 'creator',
    maxOpsPerCert: 1000,
    maxHoursPerCert: 72,
    alwaysEscalateOps: ['content_removal', 'account_suspension', 'legal_report'],
    escalateOnNewTerritory: false,
    rationale: 'DSA: content moderation decisions should be periodically reviewed',
  },
  transport: {
    facet: 'transport',
    maxOpsPerCert: 50,
    maxHoursPerCert: 4,
    alwaysEscalateOps: ['route_override', 'emergency_stop_release', 'passenger_pickup'],
    escalateOnNewTerritory: true,
    rationale: 'Autonomous transport: maximum human oversight per EU Motor Vehicle Regulation',
  },
  general: {
    facet: 'general',
    maxOpsPerCert: null,  // No ops limit
    maxHoursPerCert: null, // Use cert expiry
    alwaysEscalateOps: [],
    escalateOnNewTerritory: false,
    rationale: 'General agents: standard cert expiry provides sufficient oversight',
  },
};

// =============================================================================
// Escalation Tracker
// =============================================================================

/**
 * Tracks an agent's operations against its escalation policy.
 *
 * Framework integrations (LangChain, CrewAI) should instantiate one
 * EscalationTracker per agent and call `checkEscalation()` before
 * every operation.
 */
export class EscalationTracker {
  private policy: EscalationPolicy;
  private currentCert: DelegationCert;
  private opsSinceCert: number = 0;
  private certReceivedAt: Date;
  private visitedCells: Set<string>;

  constructor(policy: EscalationPolicy, initialCert: DelegationCert) {
    this.policy = policy;
    this.currentCert = initialCert;
    this.certReceivedAt = new Date();
    this.visitedCells = new Set<string>();
  }

  /**
   * Check whether the agent must escalate before performing an operation.
   *
   * Call this BEFORE every agent operation. If it returns an escalation,
   * the agent MUST pause and request fresh human authorization.
   *
   * @param operationType - The type of operation about to be performed
   * @param operationCell - The H3 cell where the operation will occur
   * @returns null if operation can proceed, EscalationRequired if agent must pause
   */
  checkEscalation(
    operationType: string,
    operationCell: string
  ): EscalationRequired | null {
    // 1. Basic cert validity
    if (!verifyDelegationCert(this.currentCert)) {
      return {
        reason: 'invalid_cert',
        message: 'Current delegation certificate has an invalid signature',
        policy: this.policy,
        opsSinceCert: this.opsSinceCert,
        hoursSinceCert: this.hoursSinceCert(),
      };
    }

    if (!isDelegationActive(this.currentCert)) {
      return {
        reason: 'expired_cert',
        message: 'Delegation certificate has expired',
        policy: this.policy,
        opsSinceCert: this.opsSinceCert,
        hoursSinceCert: this.hoursSinceCert(),
      };
    }

    // 2. Always-escalate operation types
    if (this.policy.alwaysEscalateOps.includes(operationType)) {
      return {
        reason: 'high_risk_operation',
        message: `Operation type '${operationType}' requires fresh human authorization per ${this.policy.facet} escalation policy`,
        policy: this.policy,
        opsSinceCert: this.opsSinceCert,
        hoursSinceCert: this.hoursSinceCert(),
      };
    }

    // 3. Operations count threshold
    if (this.policy.maxOpsPerCert !== null && this.opsSinceCert >= this.policy.maxOpsPerCert) {
      return {
        reason: 'ops_threshold',
        message: `Reached ${this.opsSinceCert} operations (limit: ${this.policy.maxOpsPerCert}). Fresh delegation required.`,
        policy: this.policy,
        opsSinceCert: this.opsSinceCert,
        hoursSinceCert: this.hoursSinceCert(),
      };
    }

    // 4. Time freshness threshold
    if (this.policy.maxHoursPerCert !== null && this.hoursSinceCert() >= this.policy.maxHoursPerCert) {
      return {
        reason: 'time_threshold',
        message: `Delegation is ${this.hoursSinceCert().toFixed(1)}h old (limit: ${this.policy.maxHoursPerCert}h). Fresh delegation required.`,
        policy: this.policy,
        opsSinceCert: this.opsSinceCert,
        hoursSinceCert: this.hoursSinceCert(),
      };
    }

    // 5. New territory cell
    if (this.policy.escalateOnNewTerritory && !this.visitedCells.has(operationCell)) {
      // First operation in this cell — if we've already visited OTHER cells,
      // then entering a new one is a territory expansion event
      if (this.visitedCells.size > 0) {
        return {
          reason: 'new_territory',
          message: `Agent entering new territory cell ${operationCell}. Fresh delegation required for ${this.policy.facet} operations in new jurisdictions.`,
          policy: this.policy,
          opsSinceCert: this.opsSinceCert,
          hoursSinceCert: this.hoursSinceCert(),
        };
      }
    }

    return null; // Operation can proceed
  }

  /**
   * Record that an operation was performed (call AFTER successful operation).
   */
  recordOperation(operationCell: string): void {
    this.opsSinceCert++;
    this.visitedCells.add(operationCell);
  }

  /**
   * Provide a fresh delegation certificate (resets all counters).
   * Called after human re-authorizes the agent.
   */
  renewDelegation(freshCert: DelegationCert): void {
    this.currentCert = freshCert;
    this.opsSinceCert = 0;
    this.certReceivedAt = new Date();
    this.visitedCells.clear();
  }

  /** Current operations count since last fresh cert */
  getOpsSinceCert(): number {
    return this.opsSinceCert;
  }

  /** Hours since current cert was received */
  hoursSinceCert(): number {
    return (Date.now() - this.certReceivedAt.getTime()) / 3_600_000;
  }

  /** Get the current escalation policy */
  getPolicy(): EscalationPolicy {
    return this.policy;
  }

  /** Get a snapshot of the tracker state */
  getState(): EscalationTrackerState {
    return {
      facet: this.policy.facet,
      opsSinceCert: this.opsSinceCert,
      hoursSinceCert: this.hoursSinceCert(),
      maxOpsPerCert: this.policy.maxOpsPerCert,
      maxHoursPerCert: this.policy.maxHoursPerCert,
      visitedCells: this.visitedCells.size,
      certHash: this.currentCert.certHash,
      certValidUntil: this.currentCert.validUntil,
    };
  }
}

/**
 * Create an EscalationTracker with the default policy for a facet.
 * Deployers can pass a custom policy to override defaults (strengthen only).
 */
export function createEscalationTracker(
  facet: string,
  initialCert: DelegationCert,
  customPolicy?: Partial<EscalationPolicy>
): EscalationTracker {
  const defaults = DEFAULT_ESCALATION_POLICIES[facet] || DEFAULT_ESCALATION_POLICIES.general;

  // Merge custom policy (can only strengthen, not weaken)
  const policy: EscalationPolicy = {
    ...defaults,
    ...customPolicy,
    facet,
  };

  // Enforce: custom policy cannot weaken defaults
  if (customPolicy?.maxOpsPerCert !== undefined && defaults.maxOpsPerCert !== null) {
    if (customPolicy.maxOpsPerCert === null || customPolicy.maxOpsPerCert > defaults.maxOpsPerCert) {
      policy.maxOpsPerCert = defaults.maxOpsPerCert;
    }
  }
  if (customPolicy?.maxHoursPerCert !== undefined && defaults.maxHoursPerCert !== null) {
    if (customPolicy.maxHoursPerCert === null || customPolicy.maxHoursPerCert > defaults.maxHoursPerCert) {
      policy.maxHoursPerCert = defaults.maxHoursPerCert;
    }
  }

  return new EscalationTracker(policy, initialCert);
}

// =============================================================================
// Types
// =============================================================================

export type EscalationReason =
  | 'invalid_cert'
  | 'expired_cert'
  | 'high_risk_operation'
  | 'ops_threshold'
  | 'time_threshold'
  | 'new_territory';

export interface EscalationRequired {
  reason: EscalationReason;
  message: string;
  policy: EscalationPolicy;
  opsSinceCert: number;
  hoursSinceCert: number;
}

export interface EscalationTrackerState {
  facet: string;
  opsSinceCert: number;
  hoursSinceCert: number;
  maxOpsPerCert: number | null;
  maxHoursPerCert: number | null;
  visitedCells: number;
  certHash: string;
  certValidUntil: string;
}
