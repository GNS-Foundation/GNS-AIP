// =================================================================
// langchain-gns-aip / GNSDelegationTool
// Deliverable 5.1-03: Agent can verify its own delegation status
//
// This is a LangChain DynamicStructuredTool that an agent can call
// mid-conversation to check: "Am I authorized to do this?"
//
// Example in a LangChain agent:
//   Agent: "Let me verify my delegation before proceeding..."
//   → calls gns_check_delegation tool
//   → gets back: { authorized: true, scope: {...}, tier: "trusted" }
// =================================================================

import { z } from 'zod';
import type { GNSAgentIdentity } from './GNSAgentIdentity';

// -----------------------------------------------------------------
// Tool Response Types
// -----------------------------------------------------------------

export interface DelegationCheckResult {
  /** Whether the agent has a valid, active delegation */
  authorized: boolean;

  /** The agent's GNS public key */
  agentPk: string;

  /** Current compliance tier */
  complianceTier: string;

  /** Numeric compliance score (0–100) */
  complianceScore: number;

  /** Delegation scope (what actions are permitted) */
  scope: Record<string, unknown> | null;

  /** Territory (H3 cells where agent may operate) */
  territory: string[];

  /** Delegation chain validity */
  delegationChain: {
    valid: boolean;
    depth: number;
    rootPrincipal?: string;
    error?: string;
  };

  /** Expiration of current delegation */
  expiresAt: string | null;

  /** Human-readable summary */
  summary: string;
}

// -----------------------------------------------------------------
// Factory function
// -----------------------------------------------------------------

/**
 * Create a LangChain-compatible tool that lets an agent check its
 * own GNS-AIP delegation status during a conversation.
 *
 * Returns a plain object matching LangChain's tool interface
 * (compatible with DynamicStructuredTool pattern).
 */
export function createGNSDelegationTool(identity: GNSAgentIdentity) {
  const schema = z.object({
    action: z
      .string()
      .optional()
      .describe(
        'Optional: specific action to check authorization for (e.g. "send_payment", "read_medical_record")'
      ),
    territory: z
      .string()
      .optional()
      .describe(
        'Optional: H3 cell to check if within authorized territory'
      ),
  });

  return {
    name: 'gns_check_delegation',
    description: [
      'Check this agent\'s GNS-AIP delegation status, compliance tier,',
      'and authorization scope. Use this before performing sensitive',
      'operations to verify you have proper delegation from your',
      'human principal. Returns authorization status, compliance',
      'score, permitted scope, and territory information.',
    ].join(' '),
    schema,
    func: async (input: z.infer<typeof schema>): Promise<string> => {
      const result = await checkDelegation(identity, input);
      return JSON.stringify(result, null, 2);
    },
  };
}

// -----------------------------------------------------------------
// Core delegation check logic
// -----------------------------------------------------------------

async function checkDelegation(
  identity: GNSAgentIdentity,
  input: { action?: string; territory?: string }
): Promise<DelegationCheckResult> {
  try {
    // Fetch manifest (includes delegation chain + compliance)
    const manifest = await identity.getManifest();

    // Check if specific action is within scope
    const delegation = identity.delegation;
    let actionAuthorized = true;

    if (input.action && delegation) {
      const scope = (delegation as unknown as Record<string, unknown>).scope as Record<string, unknown> | undefined;
      if (scope) {
        const allowedActions = scope.actions as string[] | undefined;
        if (allowedActions && !allowedActions.includes(input.action)) {
          actionAuthorized = false;
        }
      }
    }

    // Check territory
    let territoryAuthorized = true;
    if (input.territory) {
      const agentTerritory = identity.homeCells ?? [];
      territoryAuthorized = agentTerritory.includes(input.territory);
    }

    const authorized = delegation !== null && actionAuthorized && territoryAuthorized;

    // Fetch latest compliance
    let complianceTier = 'unverified';
    let complianceScore = 0;
    try {
      const compliance = await identity.getCompliance();
      complianceTier = (compliance as unknown as Record<string, string>).tier ?? 'unverified';
      complianceScore = (compliance as unknown as Record<string, number>).total_score ?? 0;
    } catch {
      // Compliance endpoint may not be available yet
    }

    // Build delegation chain info
    const chainInfo = (manifest as unknown as Record<string, unknown>).delegation_chain as {
      valid?: boolean;
      chain_depth?: number;
      root_principal?: string;
      error?: string;
    } | undefined;

    const result: DelegationCheckResult = {
      authorized,
      agentPk: identity.publicKey,
      complianceTier,
      complianceScore,
      scope: delegation
        ? ((delegation as unknown as Record<string, unknown>).scope as Record<string, unknown> ?? null)
        : null,
      territory: identity.homeCells ?? [],
      delegationChain: {
        valid: chainInfo?.valid ?? false,
        depth: chainInfo?.chain_depth ?? 0,
        rootPrincipal: chainInfo?.root_principal,
        error: chainInfo?.error,
      },
      expiresAt: delegation
        ? ((delegation as unknown as Record<string, string>).expiresAt ?? null)
        : null,
      summary: buildSummary(authorized, complianceTier, input),
    };

    return result;
  } catch (error) {
    // Return a safe error result rather than throwing
    return {
      authorized: false,
      agentPk: identity.publicKey,
      complianceTier: 'unverified',
      complianceScore: 0,
      scope: null,
      territory: [],
      delegationChain: {
        valid: false,
        depth: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      expiresAt: null,
      summary: `Delegation check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

function buildSummary(
  authorized: boolean,
  tier: string,
  input: { action?: string; territory?: string }
): string {
  const parts: string[] = [];

  if (authorized) {
    parts.push(`Agent is AUTHORIZED (tier: ${tier}).`);
  } else {
    parts.push(`Agent is NOT AUTHORIZED (tier: ${tier}).`);
  }

  if (input.action) {
    parts.push(
      authorized
        ? `Action "${input.action}" is within delegated scope.`
        : `Action "${input.action}" may not be within delegated scope.`
    );
  }

  if (input.territory) {
    parts.push(
      authorized
        ? `Territory ${input.territory} is within authorized zone.`
        : `Territory ${input.territory} may be outside authorized zone.`
    );
  }

  return parts.join(' ');
}
