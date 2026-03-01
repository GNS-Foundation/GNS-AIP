/**
 * GNSDelegationTool — Vercel AI SDK tool for GNS-AIP delegation checking.
 *
 * Creates a tool compatible with Vercel AI SDK's `generateText` / `streamText`
 * tool system. Agents can call this tool mid-conversation to verify their
 * authorization before performing sensitive actions.
 *
 * Usage:
 *   import { generateText } from 'ai';
 *   import { openai } from '@ai-sdk/openai';
 *   import { createGNSDelegationTool } from 'vercel-gns-aip';
 *
 *   const result = await generateText({
 *     model: openai('gpt-4o'),
 *     prompt: 'Check if I can perform a search',
 *     tools: {
 *       gns_check_delegation: createGNSDelegationTool({
 *         agentId: 'agent-001',
 *         backendUrl: 'https://gns-browser-production.up.railway.app',
 *       }),
 *     },
 *   });
 */

import { GNSAgentSDK, DelegationChain } from '@gns-aip/sdk';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GNSToolOptions {
  /** GNS backend URL */
  backendUrl?: string;
  /** Pre-configured SDK instance */
  sdk?: GNSAgentSDK;
  /** Provisioned agent ID */
  agentId: string;
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
 * Create a GNS-AIP delegation tool for the Vercel AI SDK.
 *
 * Returns a tool definition compatible with Vercel AI SDK's tools parameter.
 * Uses a plain object with `description`, `parameters`, and `execute`.
 *
 * Note: Vercel AI SDK tools use Zod schemas for parameters. Since we
 * list Zod as a peerDependency but don't want to import it at build time
 * (to avoid version conflicts), we provide a JSON Schema-compatible
 * parameters object that works with the AI SDK's schema validation.
 */
export function createGNSDelegationTool(options: GNSToolOptions) {
  const sdk = options.sdk || new GNSAgentSDK({ backendUrl: options.backendUrl || '' });
  const agentId = options.agentId;

  return {
    description:
      'Check GNS-AIP delegation authorization and compliance tier. ' +
      'Use before performing sensitive actions to verify this agent is authorized. ' +
      'Optionally specify an action (e.g., "search", "code", "payment") or ' +
      'territory (H3 cell) to check specific permissions.',

    parameters: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          description: 'Action to check authorization for (e.g., "search", "code", "email", "payment")',
        },
        territory: {
          type: 'string',
          description: 'H3 cell index to verify territorial authorization',
        },
      },
    },

    execute: async (input: { action?: string; territory?: string }): Promise<DelegationCheckResult> => {
      try {
        // 1. Verify delegation chain
        const chainResult = await DelegationChain.verify(sdk, agentId);

        // 2. Check specific action
        let actionAuthorized = true;
        let actionReason = 'No specific action checked';
        if (input.action) {
          const scopeResult = await DelegationChain.checkScope(sdk, agentId, input.action);
          actionAuthorized = scopeResult.authorized;
          actionReason = scopeResult.reason;
        }

        // 3. Get compliance tier
        let complianceTier = 'UNKNOWN';
        try {
          const compliance = (await sdk.getCompliance(agentId)) as Record<string, unknown>;
          complianceTier = (compliance.tier as string) || 'UNKNOWN';
        } catch {
          // May fail for new agents
        }

        // 4. Get scope from manifest
        let scope: { actions: string[]; resources: string[] } | undefined;
        try {
          const manifest = (await sdk.getAgentManifest(agentId)) as Record<string, unknown>;
          const chain = manifest.delegationChain as Array<Record<string, unknown>>;
          if (chain?.length > 0) {
            const latestCert = chain[chain.length - 1];
            const certScope = latestCert.scope as Record<string, string[]> | undefined;
            scope = {
              actions: certScope?.actions || ['*'],
              resources: certScope?.resources || ['*'],
            };
          }
        } catch {
          // Optional
        }

        // 5. Check territory
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
        const authorized = chainResult.valid && actionAuthorized && territoryAuthorized;

        return {
          authorized,
          complianceTier,
          scope,
          delegationChain: {
            valid: chainResult.valid,
            depth: chainResult.depth,
            humanRoot: chainResult.humanRoot,
          },
          summary: authorized
            ? `✓ Agent authorized at ${complianceTier} tier.${input.action ? ` Action "${input.action}" is permitted.` : ''}${input.territory ? ` Territory ${input.territory} is within bounds.` : ''}`
            : `✗ Agent NOT authorized.${!chainResult.valid ? ' Delegation chain invalid.' : ''}${!actionAuthorized ? ` Action "${input.action}" denied: ${actionReason}.` : ''}${!territoryAuthorized ? ` Territory ${input.territory} outside bounds.` : ''}`,
        };
      } catch (error) {
        return {
          authorized: false,
          complianceTier: 'UNKNOWN',
          summary: `✗ Delegation check error: ${error instanceof Error ? error.message : 'Unknown error'}. Operating in restricted mode.`,
        };
      }
    },
  };
}
