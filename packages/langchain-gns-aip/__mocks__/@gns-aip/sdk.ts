// Mock for @gns-aip/sdk used in tests

export class GNSAgentSDK {
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

  async provisionAgent(opts: any) {
    return {
      agentId: 'agent-test-001',
      pkRoot: 'ed25519-mock-public-key-base64',
      agentHandle: opts.agentHandle || 'test-agent',
      status: 'provisioned',
    };
  }

  async delegateToAgent(opts: any) {
    return {
      certHash: 'mock-cert-hash-sha256',
      delegatorPk: opts.principalPk,
      delegatePk: 'ed25519-mock-public-key-base64',
      chainDepth: 1,
      scope: opts.scope || { actions: ['*'], resources: ['*'] },
      territory: opts.territory || [],
      issuedAt: new Date().toISOString(),
      expiresAt: opts.expiresAt || null,
      isActive: true,
    };
  }

  async getAgentManifest(agentId: string) {
    return {
      agentId,
      agentHandle: 'test-agent',
      agentType: 'autonomous',
      principalPk: 'human-principal-pk',
      status: 'active',
      complianceScore: { total: 85, tier: 'VERIFIED', delegation: 25, territory: 20, history: 20, staking: 20 },
      delegationChain: [{ delegatorPk: 'human-principal-pk', delegatePk: 'ed25519-mock-public-key-base64', chainDepth: 1, scope: { actions: ['*'], resources: ['*'] }, territory: ['8a2a1072b59ffff'], isActive: true }],
      homeCells: ['8a2a1072b59ffff'],
      totalBreadcrumbs: 150,
    };
  }

  async getCompliance(agentId: string) {
    return {
      total: 85,
      tier: 'VERIFIED',
      delegation: 25,
      territory: 20,
      history: 20,
      staking: 20,
      totalBreadcrumbs: 150,
      violations: 0,
      delegationValid: true,
    };
  }

  async submitBreadcrumbs(agentId: string, breadcrumbs: any[]) {
    return {
      accepted: breadcrumbs.length,
      rejected: 0,
      epochCreated: breadcrumbs.length >= 100,
    };
  }
}

export class DelegationChain {
  static async verify(sdk: any, agentId: string) {
    return {
      valid: true,
      chain: [{ delegatorPk: 'human-principal-pk', delegatePk: 'agent-pk', chainDepth: 1, isActive: true }],
      humanRoot: 'human-principal-pk',
      depth: 1,
    };
  }

  static async checkScope(sdk: any, agentId: string, action: string) {
    const allowed = action !== 'forbidden-action';
    return { authorized: allowed, action, reason: allowed ? 'Action permitted by scope' : 'Action not in scope' };
  }
}

export class EscalationPolicy {
  static async evaluate(sdk: any, agentId: string, context: any) {
    return { shouldEscalate: false, reason: 'Within normal parameters', policy: 'default' };
  }
}

export interface AgentManifest {
  agentId: string;
  agentHandle: string;
  agentType: string;
  principalPk: string;
  status: string;
  complianceScore: any;
  delegationChain: any[];
  homeCells: string[];
  totalBreadcrumbs: number;
}
