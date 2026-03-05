/**
 * @file hitl.ts
 * @module @gns-aip/sdk
 *
 * GNS-AIP Human-in-the-Loop (HITL) Escalation Engine
 * ─────────────────────────────────────────────────────
 * Implements the EU AI Act Article 14 mandate for human oversight proportional
 * to risk level.
 *
 * Design Philosophy:
 *   "Delegation drift" is the failure mode where an agent continues acting on
 *   an old cert after the human's intent has changed. HITL prevents this by:
 *   1. Requiring fresh re-authorization for high-risk operations above a threshold
 *   2. Enforcing operation count windows (Nth-operation re-auth)
 *   3. Time-boxing authorizations with explicit TTLs
 *   4. Logging every escalation and resolution for audit
 *
 * EU AI Act Mapping:
 *   Art 14(1) — Human oversight: agents must allow humans to intervene
 *   Art 14(4) — Re-authorization intervals by risk tier
 *   Art 17    — Risk management: TierGate maps to HITL thresholds
 *   Art 13    — Transparency: all HITL events logged with timestamps
 *
 * Integration with DelegationChain:
 *   HITL does NOT replace delegation certs. It adds a runtime gate:
 *   cert.isValid() AND hitl.isAuthorized(agentPk, operation) BOTH must pass.
 *
 * Usage:
 *   const hitl = new HitlEngine();
 *   hitl.configure({ riskLevel: 'HIGH', reAuthEveryNOps: 10, ttlSeconds: 300 });
 *
 *   // Before each operation:
 *   const check = hitl.checkOperation(agentPk, 'financial', 'send_payment');
 *   if (check.requiresEscalation) {
 *     // Pause agent — request fresh human approval
 *     const token = await requestHumanApproval(check.escalationRequest);
 *     hitl.resolveEscalation(check.escalationRequest.escalationId, token, humanKeypair);
 *   }
 */

import nacl from 'tweetnacl';
import { AgentFacet, RiskLevel } from './delegation-chain.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface HitlPolicy {
  riskLevel: RiskLevel;
  /**
   * Re-authorize after every N operations on HIGH/CRITICAL facets.
   * 0 = require authorization for EVERY operation (maximum oversight).
   */
  reAuthEveryNOps: number;
  /**
   * Authorization TTL in seconds. After this window, the agent must re-auth
   * regardless of operation count.
   */
  ttlSeconds: number;
  /**
   * Facets that always require HITL re-auth regardless of count/TTL.
   * Typically: ['financial', 'delegation', 'emergency']
   */
  alwaysEscalateFacets: AgentFacet[];
  /**
   * Maximum consecutive operations allowed without human confirmation.
   * Hard ceiling regardless of policy — safety net.
   */
  hardMaxOpsBeforeReAuth: number;
}

export interface AgentOperationState {
  agentPk: string;
  /** Facet → operation count since last auth */
  opCountByFacet: Record<AgentFacet, number>;
  /** Facet → timestamp of last human authorization */
  lastAuthTimestampByFacet: Record<AgentFacet, string>;
  /** Total operations executed since identity creation */
  totalOpsAllTime: number;
  /** Pending escalation IDs (not yet resolved) */
  pendingEscalations: string[];
}

export interface HitlEscalationRequest {
  escalationId: string;
  agentPk: string;
  /** The facet triggering the escalation */
  facet: AgentFacet;
  /** Human-readable operation description */
  operationDescription: string;
  /** Why escalation is required */
  reason: EscalationReason;
  /** Timestamp when escalation was created */
  requestedAt: string;
  /** Escalation expires at this time (human must respond before) */
  expiresAt: string;
  /** Human principal pk who must authorize */
  humanPrincipalPk: string;
  /** Operation count that triggered this */
  triggerOpCount: number;
  /** Risk level */
  riskLevel: RiskLevel;
}

export type EscalationReason =
  | 'ALWAYS_ESCALATE_FACET'
  | 'OP_COUNT_THRESHOLD'
  | 'TTL_EXPIRED'
  | 'HARD_MAX_EXCEEDED'
  | 'FIRST_OP'
  | 'EXPLICIT_REQUEST';

export interface HitlAuthorizationToken {
  escalationId: string;
  agentPk: string;
  facet: AgentFacet;
  authorizedAt: string;
  authorizedByPk: string;
  /** Ed25519 signature of canonical escalationId+agentPk+facet+authorizedAt */
  humanSignature: string;
  /** Number of operations this token covers (0 = single op only) */
  authorizedOpCount: number;
  validUntil: string;
}

export interface HitlCheckResult {
  /** True = agent may proceed. False = must pause and escalate. */
  authorized: boolean;
  requiresEscalation: boolean;
  escalationRequest?: HitlEscalationRequest;
  reason?: EscalationReason;
  /** Operations remaining before next re-auth (undefined if authorized=false) */
  opsRemainingInWindow?: number;
}

export interface HitlAuditEntry {
  timestamp: string;
  agentPk: string;
  facet: AgentFacet;
  operationDescription: string;
  outcome: 'AUTHORIZED' | 'ESCALATED' | 'RESOLVED' | 'EXPIRED' | 'REVOKED';
  escalationId?: string;
  humanPk?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT POLICIES BY RISK LEVEL (EU AI Act proportionality)
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_HITL_POLICIES: Record<RiskLevel, HitlPolicy> = {
  LOW: {
    riskLevel: 'LOW',
    reAuthEveryNOps: 1000,
    ttlSeconds: 86400,           // 24 hours
    alwaysEscalateFacets: [],
    hardMaxOpsBeforeReAuth: 5000,
  },
  MEDIUM: {
    riskLevel: 'MEDIUM',
    reAuthEveryNOps: 100,
    ttlSeconds: 3600,            // 1 hour
    alwaysEscalateFacets: ['financial'],
    hardMaxOpsBeforeReAuth: 500,
  },
  HIGH: {
    riskLevel: 'HIGH',
    reAuthEveryNOps: 10,
    ttlSeconds: 300,             // 5 minutes
    alwaysEscalateFacets: ['financial', 'delegation', 'emergency'],
    hardMaxOpsBeforeReAuth: 50,
  },
  CRITICAL: {
    riskLevel: 'CRITICAL',
    reAuthEveryNOps: 1,          // Every single operation requires human auth
    ttlSeconds: 60,              // 1 minute authorization window
    alwaysEscalateFacets: ['financial', 'delegation', 'emergency', 'write', 'execute'],
    hardMaxOpsBeforeReAuth: 1,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// INTERNALS
// ─────────────────────────────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  return Array.from(nacl.randomBytes(bytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function uint8ToHex(u8: Uint8Array): string {
  return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i/2] = parseInt(hex.slice(i, i+2), 16);
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────────
// HITL ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export class HitlEngine {
  private policies = new Map<string, HitlPolicy>();
  private agentStates = new Map<string, AgentOperationState>();
  private pendingEscalations = new Map<string, HitlEscalationRequest>();
  private resolvedTokens = new Map<string, HitlAuthorizationToken>();
  private auditLog: HitlAuditEntry[] = [];

  /**
   * Register an agent and its policy.
   * Call this when creating or loading an agent identity.
   */
  registerAgent(
    agentPk: string,
    riskLevel: RiskLevel,
    customPolicy?: Partial<HitlPolicy>
  ): void {
    const base = DEFAULT_HITL_POLICIES[riskLevel];
    this.policies.set(agentPk, { ...base, ...customPolicy });
    if (!this.agentStates.has(agentPk)) {
      this.agentStates.set(agentPk, {
        agentPk,
        opCountByFacet: {} as Record<AgentFacet, number>,
        lastAuthTimestampByFacet: {} as Record<AgentFacet, string>,
        totalOpsAllTime: 0,
        pendingEscalations: [],
      });
    }
  }

  /**
   * Check whether an agent is authorized to perform an operation.
   * Call BEFORE executing any agent action.
   *
   * Returns HitlCheckResult. If requiresEscalation=true, the agent MUST pause
   * and present the escalationRequest to the human principal.
   */
  checkOperation(
    agentPk: string,
    facet: AgentFacet,
    operationDescription: string,
    humanPrincipalPk: string
  ): HitlCheckResult {
    const policy = this.policies.get(agentPk);
    if (!policy) throw new Error(`[HITL] Agent ${agentPk.slice(0,16)}... not registered`);

    const state = this.agentStates.get(agentPk)!;
    const opCount = state.opCountByFacet[facet] ?? 0;
    const lastAuth = state.lastAuthTimestampByFacet[facet];
    const now = Date.now();

    // ── Check: always-escalate facets ──────────────────────────────────────
    if (policy.alwaysEscalateFacets.includes(facet)) {
      return this._requestEscalation(agentPk, facet, operationDescription,
        'ALWAYS_ESCALATE_FACET', humanPrincipalPk, policy, opCount);
    }

    // ── Check: first operation ever on this facet ──────────────────────────
    if (!lastAuth) {
      return this._requestEscalation(agentPk, facet, operationDescription,
        'FIRST_OP', humanPrincipalPk, policy, opCount);
    }

    // ── Check: TTL expired ─────────────────────────────────────────────────
    const lastAuthMs = new Date(lastAuth).getTime();
    if (now - lastAuthMs > policy.ttlSeconds * 1000) {
      return this._requestEscalation(agentPk, facet, operationDescription,
        'TTL_EXPIRED', humanPrincipalPk, policy, opCount);
    }

    // ── Check: hard max exceeded ───────────────────────────────────────────
    if (opCount >= policy.hardMaxOpsBeforeReAuth) {
      return this._requestEscalation(agentPk, facet, operationDescription,
        'HARD_MAX_EXCEEDED', humanPrincipalPk, policy, opCount);
    }

    // ── Check: Nth operation threshold ────────────────────────────────────
    if (policy.reAuthEveryNOps > 0 && opCount > 0 && opCount % policy.reAuthEveryNOps === 0) {
      return this._requestEscalation(agentPk, facet, operationDescription,
        'OP_COUNT_THRESHOLD', humanPrincipalPk, policy, opCount);
    }

    // ── Authorized: increment counter ─────────────────────────────────────
    state.opCountByFacet[facet] = opCount + 1;
    state.totalOpsAllTime++;

    this._audit({
      timestamp: new Date().toISOString(),
      agentPk, facet, operationDescription,
      outcome: 'AUTHORIZED',
    });

    const opsRemainingInWindow = policy.reAuthEveryNOps > 0
      ? policy.reAuthEveryNOps - ((opCount + 1) % policy.reAuthEveryNOps)
      : policy.hardMaxOpsBeforeReAuth - opCount - 1;

    return { authorized: true, requiresEscalation: false, opsRemainingInWindow };
  }

  /**
   * Resolve a pending escalation with a signed human authorization token.
   * After calling this, checkOperation will pass for the authorized window.
   */
  resolveEscalation(
    escalationId: string,
    token: HitlAuthorizationToken,
    humanPublicKey: Uint8Array
  ): void {
    const req = this.pendingEscalations.get(escalationId);
    if (!req) throw new Error(`[HITL] Escalation ${escalationId.slice(0,8)} not found`);

    // Verify escalation not expired
    if (new Date(req.expiresAt) < new Date()) {
      this.pendingEscalations.delete(escalationId);
      throw new Error(`[HITL] Escalation ${escalationId.slice(0,8)} has expired`);
    }

    // Verify human signature
    const sigMessage = `${escalationId}:${token.agentPk}:${token.facet}:${token.authorizedAt}`;
    const msgBytes = new TextEncoder().encode(sigMessage);
    const sig = hexToUint8(token.humanSignature);
    const sigValid = nacl.sign.detached.verify(msgBytes, sig, humanPublicKey);
    if (!sigValid) throw new Error(`[HITL] Invalid human signature on authorization token`);

    // Verify token matches request
    if (token.agentPk !== req.agentPk || token.facet !== req.facet) {
      throw new Error(`[HITL] Token agentPk/facet mismatch`);
    }

    // Update agent state
    const state = this.agentStates.get(req.agentPk)!;
    state.opCountByFacet[req.facet] = 0;
    state.lastAuthTimestampByFacet[req.facet] = token.authorizedAt;
    state.pendingEscalations = state.pendingEscalations.filter(id => id !== escalationId);

    this.resolvedTokens.set(escalationId, token);
    this.pendingEscalations.delete(escalationId);

    this._audit({
      timestamp: new Date().toISOString(),
      agentPk: req.agentPk,
      facet: req.facet,
      operationDescription: req.operationDescription,
      outcome: 'RESOLVED',
      escalationId,
      humanPk: uint8ToHex(humanPublicKey),
    });
  }

  /**
   * Create a signed authorization token (called by the human principal's app).
   * Typically this runs on mobile (GCRUMBS app) when showing the HITL approval UI.
   */
  static createAuthorizationToken(
    escalationId: string,
    agentPk: string,
    facet: AgentFacet,
    humanKeypair: { publicKey: Uint8Array; secretKey: Uint8Array },
    authorizedOpCount: number,
    validForSeconds: number
  ): HitlAuthorizationToken {
    const authorizedAt = new Date().toISOString();
    const validUntil = new Date(Date.now() + validForSeconds * 1000).toISOString();
    const sigMessage = `${escalationId}:${agentPk}:${facet}:${authorizedAt}`;
    const msgBytes = new TextEncoder().encode(sigMessage);
    const sig = nacl.sign.detached(msgBytes, humanKeypair.secretKey);

    return {
      escalationId,
      agentPk,
      facet,
      authorizedAt,
      authorizedByPk: uint8ToHex(humanKeypair.publicKey),
      humanSignature: uint8ToHex(sig),
      authorizedOpCount,
      validUntil,
    };
  }

  /** Get full audit log for an agent (for compliance export). */
  getAuditLog(agentPk?: string): HitlAuditEntry[] {
    if (!agentPk) return [...this.auditLog];
    return this.auditLog.filter(e => e.agentPk === agentPk);
  }

  /** Get current state snapshot for an agent (for dashboard display). */
  getAgentState(agentPk: string): AgentOperationState | null {
    return this.agentStates.get(agentPk) ?? null;
  }

  /** Get all pending escalations (for human principal dashboard). */
  getPendingEscalations(humanPrincipalPk?: string): HitlEscalationRequest[] {
    const all = [...this.pendingEscalations.values()];
    if (!humanPrincipalPk) return all;
    return all.filter(e => e.humanPrincipalPk === humanPrincipalPk);
  }

  /** Generate a compliance report for EU AI Act audit. */
  generateComplianceReport(agentPk: string): {
    agentPk: string;
    generatedAt: string;
    policy: HitlPolicy | null;
    state: AgentOperationState | null;
    totalEscalations: number;
    totalResolved: number;
    totalExpired: number;
    auditEntries: HitlAuditEntry[];
    euAiActCompliance: {
      article14_humanOversight: boolean;
      article17_riskManagement: boolean;
      article13_transparency: boolean;
      overallCompliant: boolean;
    };
  } {
    const policy = this.policies.get(agentPk) ?? null;
    const state = this.agentStates.get(agentPk) ?? null;
    const entries = this.getAuditLog(agentPk);
    const escalated = entries.filter(e => e.outcome === 'ESCALATED').length;
    const resolved = entries.filter(e => e.outcome === 'RESOLVED').length;
    const expired = entries.filter(e => e.outcome === 'EXPIRED').length;

    const hasPolicy = !!policy;
    const hasAuditTrail = entries.length > 0;
    const escalationsResolvedProperly = escalated === 0 || resolved > 0;

    return {
      agentPk,
      generatedAt: new Date().toISOString(),
      policy,
      state,
      totalEscalations: escalated,
      totalResolved: resolved,
      totalExpired: expired,
      auditEntries: entries,
      euAiActCompliance: {
        article14_humanOversight: hasPolicy && escalationsResolvedProperly,
        article17_riskManagement: hasPolicy,
        article13_transparency: hasAuditTrail,
        overallCompliant: hasPolicy && hasAuditTrail && escalationsResolvedProperly,
      },
    };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private _requestEscalation(
    agentPk: string,
    facet: AgentFacet,
    operationDescription: string,
    reason: EscalationReason,
    humanPrincipalPk: string,
    policy: HitlPolicy,
    triggerOpCount: number
  ): HitlCheckResult {
    const escalationId = randomHex(16);
    const now = new Date();
    const req: HitlEscalationRequest = {
      escalationId,
      agentPk,
      facet,
      operationDescription,
      reason,
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 600_000).toISOString(), // 10 min to respond
      humanPrincipalPk,
      triggerOpCount,
      riskLevel: policy.riskLevel,
    };
    this.pendingEscalations.set(escalationId, req);
    const state = this.agentStates.get(agentPk);
    if (state) state.pendingEscalations.push(escalationId);

    this._audit({
      timestamp: now.toISOString(),
      agentPk, facet, operationDescription,
      outcome: 'ESCALATED',
      escalationId,
    });

    return { authorized: false, requiresEscalation: true, escalationRequest: req, reason };
  }

  private _audit(entry: HitlAuditEntry): void {
    this.auditLog.push(entry);
  }
}
