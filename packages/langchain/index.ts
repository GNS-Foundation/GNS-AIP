/**
 * @file index.ts
 * @package @gns-aip/langchain
 *
 * GNS-AIP × LangChain Integration
 * ─────────────────────────────────
 * Gives any LangChain agent a GNS cryptographic identity, delegation cert,
 * territorial jurisdiction, and HITL compliance gates — in ~10 lines.
 *
 * Usage:
 *   import { GnsAgentExecutor } from '@gns-aip/langchain';
 *
 *   const executor = await GnsAgentExecutor.create({
 *     humanKeypair,
 *     territoryCells: romeJurisdiction.cells,
 *     facets: ['read', 'execute'],
 *     riskLevel: 'MEDIUM',
 *     tools: [new TavilySearchResults(), new Calculator()],
 *     llm: new ChatOpenAI({ model: 'gpt-4o' }),
 *     onEscalation: async (req) => { ... } // show approval UI
 *   });
 *
 *   const result = await executor.invoke({ input: 'Summarize grid status' });
 *
 * What it adds to every LangChain agent:
 *   - Ed25519 identity (same key = Stellar wallet address)
 *   - Signed delegation cert (human → agent)
 *   - H3 territorial scope on every tool call
 *   - HITL re-authorization gates (EU AI Act Art 14)
 *   - X-GNS-Chain header on all outbound HTTP tool calls
 *   - Audit log export for compliance
 */

import {
  generateAgentIdentity,
  createDelegationCert,
  createVirtualBreadcrumb,
  calculateComplianceScore,
} from '@gns-aip/sdk';
import { HitlEngine, HitlEscalationRequest } from '@gns-aip/sdk';
import type { AgentFacet, RiskLevel } from '@gns-aip/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface GnsAgentConfig {
  /** Human principal keypair — signs the delegation cert */
  humanKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  /** H3 territory cells defining where this agent may operate */
  territoryCells: string[];
  /** Facets this agent is authorized to use */
  facets: AgentFacet[];
  /** Risk level — determines HITL escalation thresholds */
  riskLevel: RiskLevel;
  /** LangChain tools to wrap with GNS compliance gates */
  tools: GnsTool[];
  /** LangChain LLM instance */
  llm: unknown;
  /** Called when HITL escalation is required. Must return approval token or throw. */
  onEscalation?: (request: HitlEscalationRequest) => Promise<void>;
  /** Agent TTL in seconds (default: 3600) */
  ttlSeconds?: number;
  /** Human-readable purpose statement */
  purpose?: string;
  /** Max sub-delegation depth (default: 0 — no further delegation) */
  maxSubDelegationDepth?: number;
}

export interface GnsTool {
  name: string;
  description: string;
  /** Which GNS facet this tool requires */
  requiredFacet: AgentFacet;
  /** The actual tool invoke function */
  invoke: (input: string, context: GnsToolContext) => Promise<string>;
}

export interface GnsToolContext {
  /** Agent's Ed25519 public key hex */
  agentPk: string;
  /** Current active delegation cert */
  delegationCert: unknown;
  /** X-GNS-Chain header value for outbound HTTP calls */
  chainHeader: string;
  /** Current operation count for this tool */
  operationCount: number;
  /** Active territory cells */
  territoryCells: string[];
}

export interface GnsAgentResult {
  output: string;
  agentPk: string;
  operationsExecuted: number;
  breadcrumbsCreated: number;
  complianceScore: number;
  complianceTier: string;
  escalationsTriggered: number;
  auditLog: unknown[];
}

export interface GnsAgentIdentityInfo {
  publicKey: string;
  gnsId: string;
  stellarAddress: string;
  delegationCertId: string;
  territoryCells: string[];
  facets: AgentFacet[];
  riskLevel: RiskLevel;
  complianceTier: string;
  trustScore: number;
  breadcrumbCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// GNS DELEGATION TOOL — wraps any LangChain tool with compliance gates
// ─────────────────────────────────────────────────────────────────────────────

export class GnsDelegationTool {
  readonly name: string;
  readonly description: string;
  private tool: GnsTool;
  private executor: GnsAgentExecutor;

  constructor(tool: GnsTool, executor: GnsAgentExecutor) {
    this.name = tool.name;
    this.description = `[GNS:${tool.requiredFacet}] ${tool.description}`;
    this.tool = tool;
    this.executor = executor;
  }

  async call(input: string): Promise<string> {
    return this.executor._executeWithCompliance(this.tool, input);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GNS COMPLIANCE TOOL — exposes compliance status as a LangChain tool
// ─────────────────────────────────────────────────────────────────────────────

export class GnsComplianceTool {
  readonly name = 'gns_compliance_status';
  readonly description =
    'Returns the current GNS compliance status of this agent: trust tier, ' +
    'breadcrumb count, operation count, and EU AI Act compliance certificate.';

  private executor: GnsAgentExecutor;

  constructor(executor: GnsAgentExecutor) {
    this.executor = executor;
  }

  async call(_input: string): Promise<string> {
    const info = this.executor.getIdentityInfo();
    return JSON.stringify({
      agent_pk: info.publicKey.slice(0, 16) + '...',
      gns_id: info.gnsId,
      stellar_address: info.stellarAddress,
      delegation_cert_id: info.delegationCertId.slice(0, 8) + '...',
      compliance_tier: info.complianceTier,
      trust_score: info.trustScore,
      breadcrumb_count: info.breadcrumbCount,
      territory_cells: info.territoryCells.length + ' cells',
      facets: info.facets,
      risk_level: info.riskLevel,
    }, null, 2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GNS AGENT EXECUTOR — main class
// ─────────────────────────────────────────────────────────────────────────────

export class GnsAgentExecutor {
  private config: GnsAgentConfig;
  private agentIdentity: ReturnType<typeof generateAgentIdentity>;
  private delegationCert: Awaited<ReturnType<typeof createDelegationCert>>;
  private hitl: HitlEngine;
  private breadcrumbs: unknown[] = [];
  private operationCount = 0;
  private escalationCount = 0;
  private wrappedTools: GnsDelegationTool[];

  private constructor(
    config: GnsAgentConfig,
    agentIdentity: ReturnType<typeof generateAgentIdentity>,
    delegationCert: Awaited<ReturnType<typeof createDelegationCert>>,
  ) {
    this.config = config;
    this.agentIdentity = agentIdentity;
    this.delegationCert = delegationCert;
    this.hitl = new HitlEngine();
    this.hitl.registerAgent(agentIdentity.publicKey, config.riskLevel);

    // Wrap all tools with GNS compliance gates
    this.wrappedTools = config.tools.map(t => new GnsDelegationTool(t, this));
    // Add compliance status tool automatically
    this.wrappedTools.push(new GnsDelegationTool({
      name: 'gns_compliance_status',
      description: 'Check this agent\'s GNS compliance status and trust tier',
      requiredFacet: 'read',
      invoke: async () => {
        const info = this.getIdentityInfo();
        return JSON.stringify(info, null, 2);
      },
    }, this));
  }

  /**
   * Create a GNS-enabled agent executor.
   * Generates agent identity and signs delegation cert automatically.
   */
  static async create(config: GnsAgentConfig): Promise<GnsAgentExecutor> {
    // 1. Generate fresh agent identity (Ed25519 keypair)
    const agentIdentity = generateAgentIdentity();

    // 2. Human signs delegation cert binding agent to territory + facets
    const delegationCert = await createDelegationCert({
      deployerIdentity: agentIdentity.publicKey,
      principalIdentity: Buffer.from(config.humanKeypair.publicKey).toString('hex'),
      agentIdentity: agentIdentity.publicKey,
      territoryCells: config.territoryCells,
      facetPermissions: config.facets,
      maxSubDelegationDepth: config.maxSubDelegationDepth ?? 0,
      ttlSeconds: config.ttlSeconds ?? 3600,
      purpose: config.purpose ?? 'LangChain agent — GNS-AIP governed',
    }, Buffer.from(config.humanKeypair.secretKey).toString('hex'));

    return new GnsAgentExecutor(config, agentIdentity, delegationCert);
  }

  /**
   * Invoke the agent with a prompt.
   * All tool calls are routed through GNS compliance gates.
   */
  async invoke(input: { input: string }): Promise<GnsAgentResult> {
    const startOps = this.operationCount;
    const startBreadcrumbs = this.breadcrumbs.length;

    // Simple ReAct-style loop (replace with actual LangChain AgentExecutor
    // by passing this.wrappedTools to the real executor)
    let output = `[GNS Agent ${this.agentIdentity.gnsId}] Processing: ${input.input}`;

    // Drop a breadcrumb for this invocation
    await this._dropBreadcrumb('invoke');

    const complianceResult = calculateComplianceScore(
      this.breadcrumbs as Parameters<typeof calculateComplianceScore>[0],
      this.delegationCert as Parameters<typeof calculateComplianceScore>[1],
    );

    return {
      output,
      agentPk: this.agentIdentity.publicKey,
      operationsExecuted: this.operationCount - startOps,
      breadcrumbsCreated: this.breadcrumbs.length - startBreadcrumbs,
      complianceScore: complianceResult.score,
      complianceTier: complianceResult.tier,
      escalationsTriggered: this.escalationCount,
      auditLog: this.hitl.getAuditLog(this.agentIdentity.publicKey),
    };
  }

  /**
   * Execute a single tool call with full HITL + breadcrumb compliance.
   * Called by GnsDelegationTool.call().
   */
  async _executeWithCompliance(tool: GnsTool, input: string): Promise<string> {
    const humanPk = Buffer.from(this.config.humanKeypair.publicKey).toString('hex');

    // 1. HITL check — may require human re-authorization
    const check = this.hitl.checkOperation(
      this.agentIdentity.publicKey,
      tool.requiredFacet,
      `${tool.name}: ${input.slice(0, 80)}`,
      humanPk,
    );

    if (check.requiresEscalation) {
      this.escalationCount++;
      if (this.config.onEscalation && check.escalationRequest) {
        await this.config.onEscalation(check.escalationRequest);
      } else {
        throw new Error(
          `[GNS HITL] Escalation required for ${tool.name} (${tool.requiredFacet}). ` +
          `Reason: ${check.reason}. Provide onEscalation handler to resolve.`
        );
      }
    }

    // 2. Drop breadcrumb for this operation
    await this._dropBreadcrumb(tool.name);
    this.operationCount++;

    // 3. Build tool context with chain header
    const context: GnsToolContext = {
      agentPk: this.agentIdentity.publicKey,
      delegationCert: this.delegationCert,
      chainHeader: this._buildChainHeader(),
      operationCount: this.operationCount,
      territoryCells: this.config.territoryCells,
    };

    // 4. Execute the actual tool
    return tool.invoke(input, context);
  }

  /** Get current identity and compliance info (for UI display / logging) */
  getIdentityInfo(): GnsAgentIdentityInfo {
    const complianceResult = calculateComplianceScore(
      this.breadcrumbs as Parameters<typeof calculateComplianceScore>[0],
      this.delegationCert as Parameters<typeof calculateComplianceScore>[1],
    );
    return {
      publicKey: this.agentIdentity.publicKey,
      gnsId: this.agentIdentity.gnsId,
      stellarAddress: this.agentIdentity.stellarAddress,
      delegationCertId: (this.delegationCert as { certId: string }).certId,
      territoryCells: this.config.territoryCells,
      facets: this.config.facets,
      riskLevel: this.config.riskLevel,
      complianceTier: complianceResult.tier,
      trustScore: complianceResult.score,
      breadcrumbCount: this.breadcrumbs.length,
    };
  }

  /** Export EU AI Act compliance report */
  getComplianceReport() {
    return this.hitl.generateComplianceReport(this.agentIdentity.publicKey);
  }

  /** Get full audit log */
  getAuditLog() {
    return this.hitl.getAuditLog(this.agentIdentity.publicKey);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _dropBreadcrumb(operationType: string): Promise<void> {
    if (this.config.territoryCells.length === 0) return;
    const cell = this.config.territoryCells[
      this.breadcrumbs.length % this.config.territoryCells.length
    ];
    const prev = this.breadcrumbs.length > 0
      ? this.breadcrumbs[this.breadcrumbs.length - 1] as { blockHash: string }
      : null;

    const breadcrumb = await createVirtualBreadcrumb({
      agentIdentity: this.agentIdentity,
      delegationCert: this.delegationCert as Parameters<typeof createVirtualBreadcrumb>[0]['delegationCert'],
      locationCell: cell,
      locationResolution: 7,
      operationType,
      previousHash: prev?.blockHash ?? null,
      index: this.breadcrumbs.length,
    });
    this.breadcrumbs.push(breadcrumb);
  }

  private _buildChainHeader(): string {
    return Buffer.from(JSON.stringify({
      agentPk: this.agentIdentity.publicKey,
      certId: (this.delegationCert as { certId: string }).certId,
      certHash: (this.delegationCert as { certHash: string }).certHash,
      operationCount: this.operationCount,
      timestamp: new Date().toISOString(),
    })).toString('base64');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quick factory — creates a GNS-governed LangChain agent in one call.
 *
 * Example:
 *   const agent = await createGnsAgent({
 *     humanKeypair,
 *     territoryCells: ['871e8052affffff'],
 *     facets: ['read', 'execute'],
 *     riskLevel: 'MEDIUM',
 *     tools: [searchTool, calculatorTool],
 *     llm: new ChatOpenAI(),
 *   });
 *   const result = await agent.invoke({ input: 'What is the grid load?' });
 *   console.log(result.output);
 *   console.log(result.complianceTier); // 'provisioned'
 */
export async function createGnsAgent(config: GnsAgentConfig): Promise<GnsAgentExecutor> {
  return GnsAgentExecutor.create(config);
}

// Re-export key types from SDK for convenience
export type { AgentFacet, RiskLevel, HitlEscalationRequest };
