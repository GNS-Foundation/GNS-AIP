/**
 * GNSDelegationTool — An OpenAI Agents SDK function tool that lets agents
 * verify their own GNS-AIP delegation, compliance tier, and authorization
 * mid-conversation.
 *
 * Usage:
 *   import { Agent, run } from '@openai/agents';
 *   import { createGNSDelegationTool } from 'openai-gns-aip';
 *
 *   const delegationTool = createGNSDelegationTool({
 *     backendUrl: 'https://gns-browser-production.up.railway.app',
 *     agentId: 'agent-001',
 *   });
 *
 *   const agent = new Agent({
 *     name: 'Compliant Agent',
 *     instructions: 'Before performing sensitive actions, verify your authorization.',
 *     tools: [delegationTool],
 *   });
 *
 * The agent can call this tool mid-conversation:
 *   "Let me verify my authorization to perform this search..."
 *   → calls gns_check_delegation({ action: 'search' })
 *   → returns { authorized: true, complianceTier: 'VERIFIED', ... }
 */

import { GNSAgentSDK, DelegationChain } from '@gns-aip/sdk';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GNSDelegationToolOptions {
  /** GNS backend URL */
  backendUrl?: string;
  /** Pre-configured SDK instance */
  sdk?: GNSAgentSDK;
  /** Provisioned agent ID */
  agentId: string;
}

export interface DelegationCheckInput {
  /** Action to check authorization for (e.g. 'search', 'code', 'email') */
  action?: string;
  /** H3 cell to check territory authorization */
  territory?: string;
}

export interface DelegationCheckResult {
  authorized: boolean;
  complianceTier: string;
  scope?: {
    actions: string[];
    resources: string[];
  };
  delegationChain?: {
    valid: boolean;
    depth: number;
    humanRoot: string;
  };
  summary: string;
}

// ─── Tool Factory ────────────────────────────────────────────────────────────

/**
 * Create an OpenAI Agents SDK function tool for GNS-AIP delegation checking.
 *
 * Returns a tool definition compatible with `@openai/agents` tool() pattern.
 * The tool uses a plain object format that works with the Agent's tools array.
 *
 * @returns Tool definition object with name, description, parameters, and execute
 */
export function createGNSDelegationTool(options: GNSDelegationToolOptions) {
  const sdk = options.sdk || new GNSAgentSDK({ backendUrl: options.backendUrl || '' });
  const agentId = options.agentId;

  return {
    name: 'gns_check_delegation',

    description:
      'Check GNS-AIP delegation authorization and compliance tier. ' +
      'Use this tool before performing sensitive actions to verify that ' +
      'this agent is authorized. Optionally specify an action name or ' +
      'territory (H3 cell) to check specific permissions.',

    parameters: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          description:
            'The action to check authorization for (e.g., "search", "code", "email", "payment")',
        },
        territory: {
          type: 'string',
          description: 'H3 cell index to verify territorial authorization',
        },
      },
      required: [] as string[],
    },

    execute: async (input: DelegationCheckInput): Promise<string> => {
      try {
        // 1. Check delegation chain
        const chainResult = await DelegationChain.verify(sdk, agentId);

        // 2. Check specific action if provided
        let actionAuthorized = true;
        let actionReason = 'No specific action checked';

        if (input.action) {
          const scopeResult = await DelegationChain.checkScope(sdk, agentId, input.action);
          actionAuthorized = scopeResult.authorized;
          actionReason = scopeResult.reason;
        }

        // 3. Get compliance score
        let complianceTier = 'UNKNOWN';
        let complianceScore: Record<string, unknown> = {};
        try {
          const compliance = (await sdk.getCompliance(agentId)) as Record<string, unknown>;
          complianceTier = (compliance.tier as string) || 'UNKNOWN';
          complianceScore = compliance;
        } catch {
          // Compliance fetch may fail if agent is very new
        }

        // 4. Get manifest for scope details
        let scope: { actions: string[]; resources: string[] } | undefined;
        try {
          const manifest = (await sdk.getAgentManifest(agentId)) as Record<string, unknown>;
          const chain = manifest.delegationChain as Array<Record<string, unknown>>;
          if (chain && chain.length > 0) {
            const latestCert = chain[chain.length - 1];
            const certScope = latestCert.scope as Record<string, string[]> | undefined;
            scope = {
              actions: certScope?.actions || ['*'],
              resources: certScope?.resources || ['*'],
            };
          }
        } catch {
          // Manifest fetch is optional
        }

        // 5. Check territory if provided
        let territoryAuthorized = true;
        if (input.territory) {
          try {
            const manifest = (await sdk.getAgentManifest(agentId)) as Record<string, unknown>;
            const homeCells = (manifest.homeCells as string[]) || [];
            territoryAuthorized = homeCells.includes(input.territory) || homeCells.includes('*');
          } catch {
            territoryAuthorized = false;
          }
        }

        // 6. Build result
        const authorized =
          chainResult.valid && actionAuthorized && territoryAuthorized;

        const result: DelegationCheckResult = {
          authorized,
          complianceTier,
          scope,
          delegationChain: {
            valid: chainResult.valid,
            depth: chainResult.depth,
            humanRoot: chainResult.humanRoot,
          },
          summary: authorized
            ? `✓ Agent authorized at ${complianceTier} tier.${input.action ? ` Action "${input.action}" is permitted.` : ''}${input.territory ? ` Territory ${input.territory} is within operational bounds.` : ''}`
            : `✗ Agent NOT authorized.${!chainResult.valid ? ' Delegation chain invalid.' : ''}${!actionAuthorized ? ` Action "${input.action}" denied: ${actionReason}.` : ''}${!territoryAuthorized ? ` Territory ${input.territory} outside operational bounds.` : ''}`,
        };

        return JSON.stringify(result, null, 2);
      } catch (error) {
        const errorResult: DelegationCheckResult = {
          authorized: false,
          complianceTier: 'UNKNOWN',
          summary: `✗ Delegation check error: ${error instanceof Error ? error.message : 'Unknown error'}. Operating in restricted mode.`,
        };
        return JSON.stringify(errorResult, null, 2);
      }
    },
  };
}

// ─── Guardrail Factory ───────────────────────────────────────────────────────

/**
 * Create an input guardrail that checks GNS-AIP compliance before
 * the agent processes any input.
 *
 * If the agent's compliance tier is below the minimum required,
 * the guardrail trips and blocks execution.
 *
 * @returns InputGuardrail-compatible object
 */
export function createGNSComplianceGuardrail(options: {
  sdk?: GNSAgentSDK;
  backendUrl?: string;
  agentId: string;
  minimumTier?: 'SHADOW' | 'BASIC' | 'VERIFIED' | 'TRUSTED' | 'SOVEREIGN';
}) {
  const sdk = options.sdk || new GNSAgentSDK({ backendUrl: options.backendUrl || '' });
  const agentId = options.agentId;
  const tierOrder = ['SHADOW', 'BASIC', 'VERIFIED', 'TRUSTED', 'SOVEREIGN'];
  const minimumTierIndex = tierOrder.indexOf(options.minimumTier || 'BASIC');

  return {
    name: 'gns_compliance_check',

    execute: async (): Promise<{
      tripwireTriggered: boolean;
      outputInfo?: { reason: string; currentTier: string; minimumTier: string };
    }> => {
      try {
        const compliance = (await sdk.getCompliance(agentId)) as Record<string, unknown>;
        const currentTier = (compliance.tier as string) || 'SHADOW';
        const currentTierIndex = tierOrder.indexOf(currentTier);

        const meetsMinimum = currentTierIndex >= minimumTierIndex;

        return {
          tripwireTriggered: !meetsMinimum,
          outputInfo: meetsMinimum
            ? undefined
            : {
                reason: `Agent compliance tier ${currentTier} is below minimum ${options.minimumTier || 'BASIC'}`,
                currentTier,
                minimumTier: options.minimumTier || 'BASIC',
              },
        };
      } catch {
        return {
          tripwireTriggered: true,
          outputInfo: {
            reason: 'Failed to verify compliance — blocking for safety',
            currentTier: 'UNKNOWN',
            minimumTier: options.minimumTier || 'BASIC',
          },
        };
      }
    },
  };
}
