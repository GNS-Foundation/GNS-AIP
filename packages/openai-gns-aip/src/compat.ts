/**
 * GNSAgentSDK — Compatibility class for openai-gns-aip.
 *
 * Wraps the functional @gns-aip/sdk API into the class-based interface
 * that GNSAgentHooks, GNSDelegationTool, and GNSTracingExporter expect.
 */

import {
  generateAgentIdentity,
  createDelegationCert,
  verifyDelegationCert,
  isDelegationActive,
  isDelegationAuthorizedForFacet,
  determineTier,
  type AgentIdentity,
  type DelegationCert,
  type ComplianceTier,
} from '@gns-aip/sdk';

// ─── Types ───────────────────────────────────────────────────────────────

export interface GNSAgentSDKOptions {
  backendUrl?: string;
}

export interface ProvisionOptions {
  agentType: string;
  agentHandle?: string;
  homeCells?: string[];
  stellarAddress?: string;
  gnsStaked?: number;
  jurisdiction?: string;
}

export interface DelegateOptions {
  agentId: string;
  principalPk?: string;
  principalPublicKey?: string;
  principalSecretKey?: string;
  principalSk?: string;
  scope?: {
    cells?: string[];
    facets?: string[];
    actions?: string[];
    validityHours?: number;
  };
  territory?: string[];
  expiresAt?: string;
  maxSubdelegationDepth?: number;
}

export interface ProvisionResult {
  agentId: string;
  publicKey: string;
  pkRoot: string;
  stellarAddress: string;
  identity: AgentIdentity;
}

// ─── GNSAgentSDK ─────────────────────────────────────────────────────────

export class GNSAgentSDK {
  private agents = new Map<string, {
    identity: AgentIdentity;
    delegation?: DelegationCert;
    breadcrumbs: unknown[];
    provisionedAt: string;
  }>();

  constructor(_options?: GNSAgentSDKOptions) {}

  async provisionAgent(opts: ProvisionOptions): Promise<ProvisionResult> {
    const identity = generateAgentIdentity();
    const agentId = identity.gnsId;

    this.agents.set(agentId, {
      identity,
      breadcrumbs: [],
      provisionedAt: new Date().toISOString(),
    });

    return {
      agentId,
      publicKey: identity.publicKey,
      pkRoot: identity.publicKey,
      stellarAddress: identity.stellarAddress,
      identity,
    };
  }

  async delegateToAgent(opts: DelegateOptions): Promise<DelegationCert> {
    const agent = this.agents.get(opts.agentId);
    if (!agent) throw new Error(`Agent ${opts.agentId} not provisioned`);

    const principalPk = opts.principalPk ?? opts.principalPublicKey ?? '';
    const principalSk = opts.principalSecretKey ?? opts.principalSk ?? '';
    const cells = opts.territory ?? opts.scope?.cells ?? [];
    const facets = opts.scope?.facets ?? opts.scope?.actions ?? ['*'];

    // Compute validUntil from either expiresAt or scope.validityHours
    let validUntil: string | undefined;
    if (opts.expiresAt) {
      validUntil = opts.expiresAt;
    } else if (opts.scope?.validityHours) {
      validUntil = new Date(Date.now() + opts.scope.validityHours * 3600000).toISOString();
    }

    const cert = await createDelegationCert({
      deployerIdentity: principalPk,
      principalIdentity: principalPk,
      agentIdentity: agent.identity.publicKey,
      territoryCells: cells,
      facetPermissions: facets,
      maxSubDelegationDepth: opts.maxSubdelegationDepth ?? 0,
      ...(validUntil ? { validUntil } : {}),
    }, principalSk);

    agent.delegation = cert;
    return cert;
  }

  async submitBreadcrumbs(_agentId: string, crumbs: unknown[]): Promise<{ accepted: number; rejected: number }> {
    // Store breadcrumbs in memory. In production, POST to Supabase backend.
    const agent = this.agents.get(_agentId);
    if (agent) {
      agent.breadcrumbs.push(...crumbs);
    }
    return { accepted: crumbs.length, rejected: 0 };
  }

  async getCompliance(agentId: string): Promise<Record<string, unknown> | null> {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const tier = determineTier(agent.breadcrumbs.length, agent.breadcrumbs.length > 0 ? 25 : 0);

    return {
      tier: tier,
      totalOperations: agent.breadcrumbs.length,
      chainValid: true,
      violations: 0,
    };
  }

  async getAgentManifest(agentId: string): Promise<Record<string, unknown> | null> {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    return {
      publicKey: agent.identity.publicKey,
      handle: agentId,
      domain: 'general',
      homeCells: agent.delegation?.territoryCells ?? [],
      delegationChain: agent.delegation ? [{
        principalIdentity: agent.delegation.principalIdentity,
        agentIdentity: agent.delegation.agentIdentity,
        scope: {
          actions: agent.delegation.facetPermissions ?? ['*'],
          resources: agent.delegation.territoryCells ?? ['*'],
        },
      }] : [],
    };
  }

  getAgent(agentId: string) {
    return this.agents.get(agentId);
  }
}

// ─── DelegationChain static adapter ──────────────────────────────────────

export const DelegationChainCompat = {
  async verify(sdk: GNSAgentSDK, agentId: string): Promise<{
    valid: boolean;
    chain: DelegationCert[];
    depth: number;
    humanRoot: string;
  }> {
    const agent = sdk.getAgent(agentId);
    if (!agent?.delegation) {
      return { valid: false, chain: [], depth: 0, humanRoot: '' };
    }
    const cert = agent.delegation;
    const sigValid = verifyDelegationCert(cert);
    const active = isDelegationActive(cert);
    return {
      valid: sigValid && active,
      chain: [cert],
      depth: 1,
      humanRoot: cert.principalIdentity ?? '',
    };
  },

  async checkScope(
    sdk: GNSAgentSDK,
    agentId: string,
    action: string,
  ): Promise<{ authorized: boolean; reason: string }> {
    const agent = sdk.getAgent(agentId);
    if (!agent?.delegation) {
      return { authorized: false, reason: 'No delegation certificate' };
    }
    const cert = agent.delegation;
    if (!isDelegationActive(cert)) {
      return { authorized: false, reason: 'Delegation certificate expired' };
    }
    const facetOk = isDelegationAuthorizedForFacet(cert, action);
    if (!facetOk) {
      return { authorized: false, reason: `Action "${action}" not in delegation scope` };
    }
    return { authorized: true, reason: '' };
  },
};
