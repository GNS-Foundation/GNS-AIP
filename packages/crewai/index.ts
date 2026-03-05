/**
 * @file index.ts
 * @package @gns-aip/crewai
 *
 * GNS-AIP × CrewAI Integration
 * ──────────────────────────────
 * Maps the CrewAI Manager/Worker crew pattern directly onto GNS-AIP
 * multi-hop delegation chains:
 *
 *   CrewAI Crew          GNS-AIP Chain
 *   ────────────         ─────────────────────────────────────
 *   Human (you)    →     Human Principal (Ed25519 keypair)
 *   Manager Agent  →     Depth-2 delegation cert (human → manager)
 *   Worker Agent   →     Depth-1 delegation cert (manager → worker)
 *   Task execution →     Breadcrumb dropped per tool call
 *   Crew output    →     Compliance report (EU AI Act Art 13/14/17)
 *
 * Usage:
 *   import { GnsCrew } from '@gns-aip/crewai';
 *
 *   const crew = await GnsCrew.create({
 *     humanKeypair,
 *     territoryCells: romeJurisdiction.cells,
 *     manager: {
 *       role: 'Grid Operations Manager',
 *       goal: 'Coordinate monitoring of Rome electricity grid',
 *       tools: [planningTool, delegationTool],
 *       riskLevel: 'HIGH',
 *     },
 *     workers: [
 *       {
 *         role: 'Sensor Data Fetcher',
 *         goal: 'Retrieve real-time telemetry from substations',
 *         tools: [sensorTool],
 *         facets: ['read', 'telemetry'],
 *         riskLevel: 'LOW',
 *         territoryCells: [romeJurisdiction.cells[0]], // narrowed
 *       },
 *       {
 *         role: 'Anomaly Detector',
 *         goal: 'Detect voltage anomalies in sensor data',
 *         tools: [analysisTool],
 *         facets: ['read', 'execute'],
 *         riskLevel: 'MEDIUM',
 *       },
 *     ],
 *     tasks: [
 *       { description: 'Fetch current grid load for all Rome substations', assignTo: 'worker:0' },
 *       { description: 'Analyze data and flag anomalies', assignTo: 'worker:1' },
 *       { description: 'Summarize findings for human operator', assignTo: 'manager' },
 *     ],
 *     llm,
 *   });
 *
 *   const result = await crew.kickoff();
 *   console.log(result.output);
 *   console.log(result.delegationChainValid); // true
 */

import {
  generateAgentIdentity,
  createDelegationCert,
  createSubDelegation,
  buildDelegationChain,
  verifyDelegationChain,
  getEffectiveConstraints,
  createVirtualBreadcrumb,
  calculateComplianceScore,
} from '@gns-aip/sdk';
import { HitlEngine, HitlEscalationRequest, DEFAULT_HITL_POLICIES } from '@gns-aip/sdk';
import type { AgentFacet, RiskLevel } from '@gns-aip/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface GnsCrewConfig {
  /** Human principal keypair — root of all delegation chains */
  humanKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  /** Base H3 territory for the entire crew */
  territoryCells: string[];
  /** Manager agent configuration */
  manager: GnsManagerConfig;
  /** Worker agent configurations */
  workers: GnsWorkerConfig[];
  /** Tasks to execute */
  tasks: GnsTaskConfig[];
  /** LangChain-compatible LLM */
  llm: unknown;
  /** Called when HITL escalation required */
  onEscalation?: (request: HitlEscalationRequest, agentRole: string) => Promise<void>;
  /** Verbose logging */
  verbose?: boolean;
}

export interface GnsManagerConfig {
  role: string;
  goal: string;
  backstory?: string;
  tools: GnsCrewTool[];
  facets?: AgentFacet[];
  riskLevel: RiskLevel;
  /** Max sub-delegation depth — how many worker hops allowed (default: workers.length) */
  maxSubDelegationDepth?: number;
}

export interface GnsWorkerConfig {
  role: string;
  goal: string;
  backstory?: string;
  tools: GnsCrewTool[];
  facets: AgentFacet[];
  riskLevel: RiskLevel;
  /** Optional: narrow territory below manager's scope */
  territoryCells?: string[];
}

export interface GnsTaskConfig {
  description: string;
  expectedOutput?: string;
  /** 'manager' | 'worker:0' | 'worker:1' ... */
  assignTo: string;
  /** Which facet this task requires */
  requiredFacet?: AgentFacet;
  /** Whether task output feeds into next task context */
  contextPassthrough?: boolean;
}

export interface GnsCrewTool {
  name: string;
  description: string;
  requiredFacet: AgentFacet;
  invoke: (input: string, context: GnsCrewToolContext) => Promise<string>;
}

export interface GnsCrewToolContext {
  agentPk: string;
  agentRole: string;
  chainHeader: string;
  delegationDepth: number;
  humanPrincipalPk: string;
  territoryCells: string[];
  operationCount: number;
}

export interface GnsCrewResult {
  output: string;
  /** Full chain verified from every worker back to human principal */
  delegationChainValid: boolean;
  /** Human principal pk that anchors all chains */
  humanPrincipalPk: string;
  /** Per-agent compliance summary */
  agentReports: GnsAgentReport[];
  /** Total breadcrumbs dropped across all agents */
  totalBreadcrumbs: number;
  /** Total HITL escalations triggered */
  totalEscalations: number;
  /** Task execution log */
  taskLog: GnsTaskLog[];
  /** EU AI Act overall compliance */
  euAiActCompliant: boolean;
}

export interface GnsAgentReport {
  role: string;
  agentPk: string;
  delegationDepth: number;
  complianceTier: string;
  trustScore: number;
  breadcrumbCount: number;
  operationCount: number;
  escalations: number;
  chainValid: boolean;
}

export interface GnsTaskLog {
  taskDescription: string;
  assignedTo: string;
  agentPk: string;
  facet: AgentFacet;
  output: string;
  breadcrumbHash: string;
  timestamp: string;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL AGENT STATE
// ─────────────────────────────────────────────────────────────────────────────

interface GnsInternalAgent {
  role: string;
  identity: ReturnType<typeof generateAgentIdentity>;
  delegationCert: Awaited<ReturnType<typeof createDelegationCert>>;
  parentCert: Awaited<ReturnType<typeof createDelegationCert>> | null;
  territoryCells: string[];
  facets: AgentFacet[];
  riskLevel: RiskLevel;
  tools: GnsCrewTool[];
  breadcrumbs: unknown[];
  operationCount: number;
  escalationCount: number;
  depth: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// GNS CREW
// ─────────────────────────────────────────────────────────────────────────────

export class GnsCrew {
  private config: GnsCrewConfig;
  private humanPkHex: string;
  private manager!: GnsInternalAgent;
  private workers: GnsInternalAgent[] = [];
  private hitl: HitlEngine;
  private taskLog: GnsTaskLog[] = [];

  private constructor(config: GnsCrewConfig) {
    this.config = config;
    this.humanPkHex = Buffer.from(config.humanKeypair.publicKey).toString('hex');
    this.hitl = new HitlEngine();
  }

  /**
   * Create a GNS-governed crew.
   * Provisions all agent identities and signs the full delegation chain.
   *
   * Chain: Human → Manager (depth N) → Worker 0 (depth N-1) → Worker 1 (depth N-2) ...
   */
  static async create(config: GnsCrewConfig): Promise<GnsCrew> {
    const crew = new GnsCrew(config);
    await crew._provision();
    return crew;
  }

  /**
   * Execute all tasks in sequence.
   * Manager orchestrates, workers execute within their scoped delegation.
   */
  async kickoff(): Promise<GnsCrewResult> {
    if (this.config.verbose) {
      console.log('\n🚀 GNS Crew kickoff');
      console.log(`   Human principal: ${this.humanPkHex.slice(0, 16)}...`);
      console.log(`   Manager: ${this.manager.role} (depth ${this.manager.depth})`);
      this.workers.forEach((w, i) =>
        console.log(`   Worker ${i}: ${w.role} (depth ${w.depth}, facets: ${w.facets.join(', ')})`)
      );
      console.log(`   Tasks: ${this.config.tasks.length}`);
    }

    // Verify all delegation chains before starting
    const chainCheck = this._verifyAllChains();
    if (!chainCheck.valid) {
      throw new Error(`[GnsCrew] Delegation chain invalid: ${chainCheck.errors.join('; ')}`);
    }

    let taskContext = '';
    const outputs: string[] = [];

    for (const task of this.config.tasks) {
      const agent = this._resolveAgent(task.assignTo);
      const facet = task.requiredFacet ?? agent.facets[0] ?? 'execute';
      const start = Date.now();

      if (this.config.verbose) {
        console.log(`\n📋 Task: "${task.description.slice(0, 60)}..."`);
        console.log(`   Assigned to: ${agent.role}`);
      }

      // HITL check
      const check = this.hitl.checkOperation(
        agent.identity.publicKey,
        facet,
        task.description,
        this.humanPkHex,
      );

      if (check.requiresEscalation) {
        agent.escalationCount++;
        if (this.config.onEscalation && check.escalationRequest) {
          await this.config.onEscalation(check.escalationRequest, agent.role);
        } else if (check.requiresEscalation) {
          if (this.config.verbose) {
            console.log(`   ⚠️  HITL escalation: ${check.reason} — auto-approving in dev mode`);
          }
          // Dev mode: auto-resolve. Production: throw or await human.
        }
      }

      // Find matching tool or use default
      const tool = agent.tools.find(t => t.requiredFacet === facet) ?? agent.tools[0];
      let output = '';

      if (tool) {
        const ctx: GnsCrewToolContext = {
          agentPk: agent.identity.publicKey,
          agentRole: agent.role,
          chainHeader: this._buildChainHeader(agent),
          delegationDepth: agent.depth,
          humanPrincipalPk: this.humanPkHex,
          territoryCells: agent.territoryCells,
          operationCount: agent.operationCount,
        };
        const inputWithContext = taskContext
          ? `${task.description}\n\nContext from previous task:\n${taskContext}`
          : task.description;
        output = await tool.invoke(inputWithContext, ctx);
      } else {
        output = `[${agent.role}] Task acknowledged: ${task.description}`;
      }

      // Drop breadcrumb
      const breadcrumb = await this._dropBreadcrumb(agent, task.description);
      agent.operationCount++;

      if (task.contextPassthrough) taskContext = output;

      outputs.push(output);
      this.taskLog.push({
        taskDescription: task.description,
        assignedTo: task.assignTo,
        agentPk: agent.identity.publicKey,
        facet,
        output,
        breadcrumbHash: (breadcrumb as { blockHash: string }).blockHash,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - start,
      });

      if (this.config.verbose) {
        console.log(`   ✅ Output: ${output.slice(0, 80)}...`);
      }
    }

    return this._buildResult(outputs);
  }

  /**
   * Get the delegation chain for a specific worker.
   * Returns array from human root → manager → worker.
   */
  getWorkerChain(workerIndex: number): unknown[] {
    const worker = this.workers[workerIndex];
    if (!worker) throw new Error(`Worker ${workerIndex} not found`);
    const allCerts = [
      this.manager.delegationCert,
      ...this.workers.map(w => w.delegationCert),
    ];
    return buildDelegationChain(worker.delegationCert as Parameters<typeof buildDelegationChain>[0], allCerts as Parameters<typeof buildDelegationChain>[1]);
  }

  /** Get effective constraints for a worker (intersection across full chain) */
  getWorkerConstraints(workerIndex: number) {
    const chain = this.getWorkerChain(workerIndex);
    return getEffectiveConstraints(chain as Parameters<typeof getEffectiveConstraints>[0]);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async _provision(): Promise<void> {
    const cfg = this.config;
    const maxDepth = cfg.manager.maxSubDelegationDepth ?? cfg.workers.length;

    // 1. Provision Manager (Human → Manager)
    const managerIdentity = generateAgentIdentity();
    const managerCert = await createDelegationCert({
      deployerIdentity: managerIdentity.publicKey,
      principalIdentity: this.humanPkHex,
      agentIdentity: managerIdentity.publicKey,
      territoryCells: cfg.territoryCells,
      facetPermissions: cfg.manager.facets ?? ['read', 'write', 'execute', 'delegation'],
      maxSubDelegationDepth: maxDepth,
      ttlSeconds: 3600,
      purpose: `Manager: ${cfg.manager.role}`,
    }, Buffer.from(cfg.humanKeypair.secretKey).toString('hex'));

    this.manager = {
      role: cfg.manager.role,
      identity: managerIdentity,
      delegationCert: managerCert,
      parentCert: null,
      territoryCells: cfg.territoryCells,
      facets: cfg.manager.facets ?? ['read', 'write', 'execute', 'delegation'],
      riskLevel: cfg.manager.riskLevel,
      tools: cfg.manager.tools,
      breadcrumbs: [],
      operationCount: 0,
      escalationCount: 0,
      depth: maxDepth,
    };

    this.hitl.registerAgent(managerIdentity.publicKey, cfg.manager.riskLevel);

    // 2. Provision Workers (Manager → Worker N)
    for (let i = 0; i < cfg.workers.length; i++) {
      const workerCfg = cfg.workers[i];
      const workerDepth = maxDepth - 1 - i;
      const workerCells = workerCfg.territoryCells ?? cfg.territoryCells;

      // Validate territory is subset of manager
      const managerCells = new Set(cfg.territoryCells);
      const invalidCells = workerCells.filter(c => !managerCells.has(c));
      if (invalidCells.length > 0) {
        throw new Error(
          `[GnsCrew] Worker ${i} (${workerCfg.role}) territory contains cells not in manager scope`
        );
      }

      const workerIdentity = generateAgentIdentity();
      const workerCert = await createSubDelegation(
        managerCert,
        workerIdentity.publicKey,
        managerIdentity.secretKey,
        {
          territoryCells: workerCells,
          facetPermissions: workerCfg.facets,
          ttlSeconds: 3600,
          purpose: `Worker: ${workerCfg.role}`,
        }
      );

      this.workers.push({
        role: workerCfg.role,
        identity: workerIdentity,
        delegationCert: workerCert,
        parentCert: managerCert,
        territoryCells: workerCells,
        facets: workerCfg.facets,
        riskLevel: workerCfg.riskLevel,
        tools: workerCfg.tools,
        breadcrumbs: [],
        operationCount: 0,
        escalationCount: 0,
        depth: workerDepth,
      });

      this.hitl.registerAgent(workerIdentity.publicKey, workerCfg.riskLevel);
    }
  }

  private _resolveAgent(assignTo: string): GnsInternalAgent {
    if (assignTo === 'manager') return this.manager;
    const match = assignTo.match(/^worker:(\d+)$/);
    if (match) {
      const idx = parseInt(match[1]);
      if (!this.workers[idx]) throw new Error(`Worker ${idx} not found`);
      return this.workers[idx];
    }
    // Try by role name
    const byRole = [this.manager, ...this.workers].find(
      a => a.role.toLowerCase() === assignTo.toLowerCase()
    );
    if (byRole) return byRole;
    throw new Error(`[GnsCrew] Cannot resolve agent: ${assignTo}`);
  }

  private _verifyAllChains(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const humanPkSet = new Set([this.humanPkHex]);
    const allCerts = [
      this.manager.delegationCert,
      ...this.workers.map(w => w.delegationCert),
    ];

    // Verify manager chain
    const managerChain = buildDelegationChain(
      this.manager.delegationCert as Parameters<typeof buildDelegationChain>[0],
      allCerts as Parameters<typeof buildDelegationChain>[1]
    );
    const managerVerify = verifyDelegationChain(
      managerChain as Parameters<typeof verifyDelegationChain>[0],
      humanPkSet
    );
    if (!managerVerify.valid) {
      errors.push(`Manager chain: ${managerVerify.errors.join(', ')}`);
    }

    // Verify each worker chain
    for (let i = 0; i < this.workers.length; i++) {
      const workerChain = buildDelegationChain(
        this.workers[i].delegationCert as Parameters<typeof buildDelegationChain>[0],
        allCerts as Parameters<typeof buildDelegationChain>[1]
      );
      const workerVerify = verifyDelegationChain(
        workerChain as Parameters<typeof verifyDelegationChain>[0],
        humanPkSet
      );
      if (!workerVerify.valid) {
        errors.push(`Worker ${i} (${this.workers[i].role}) chain: ${workerVerify.errors.join(', ')}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private async _dropBreadcrumb(agent: GnsInternalAgent, operationType: string): Promise<unknown> {
    const cell = agent.territoryCells[agent.breadcrumbs.length % agent.territoryCells.length];
    const prev = agent.breadcrumbs.length > 0
      ? agent.breadcrumbs[agent.breadcrumbs.length - 1] as { blockHash: string }
      : null;
    const breadcrumb = await createVirtualBreadcrumb({
      agentIdentity: agent.identity,
      delegationCert: agent.delegationCert as Parameters<typeof createVirtualBreadcrumb>[0]['delegationCert'],
      locationCell: cell,
      locationResolution: 7,
      operationType,
      previousHash: prev?.blockHash ?? null,
      index: agent.breadcrumbs.length,
    });
    agent.breadcrumbs.push(breadcrumb);
    return breadcrumb;
  }

  private _buildChainHeader(agent: GnsInternalAgent): string {
    return Buffer.from(JSON.stringify({
      agentPk: agent.identity.publicKey,
      role: agent.role,
      depth: agent.depth,
      certId: (agent.delegationCert as { certId: string }).certId,
      humanPrincipalPk: this.humanPkHex,
      timestamp: new Date().toISOString(),
    })).toString('base64');
  }

  private _buildResult(outputs: string[]): GnsCrewResult {
    const allAgents = [this.manager, ...this.workers];
    const chainCheck = this._verifyAllChains();

    const agentReports: GnsAgentReport[] = allAgents.map(agent => {
      const compliance = calculateComplianceScore(
        agent.breadcrumbs as Parameters<typeof calculateComplianceScore>[0],
        agent.delegationCert as Parameters<typeof calculateComplianceScore>[1],
      );
      return {
        role: agent.role,
        agentPk: agent.identity.publicKey,
        delegationDepth: agent.depth,
        complianceTier: compliance.tier,
        trustScore: compliance.score,
        breadcrumbCount: agent.breadcrumbs.length,
        operationCount: agent.operationCount,
        escalations: agent.escalationCount,
        chainValid: chainCheck.valid,
      };
    });

    const totalBreadcrumbs = allAgents.reduce((sum, a) => sum + a.breadcrumbs.length, 0);
    const totalEscalations = allAgents.reduce((sum, a) => sum + a.escalationCount, 0);
    const allCompliant = agentReports.every(r => r.chainValid);

    return {
      output: outputs[outputs.length - 1] ?? '',
      delegationChainValid: chainCheck.valid,
      humanPrincipalPk: this.humanPkHex,
      agentReports,
      totalBreadcrumbs,
      totalEscalations,
      taskLog: this.taskLog,
      euAiActCompliant: allCompliant,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a GNS-governed CrewAI crew in one call.
 *
 * Example — Terna grid monitoring crew:
 *
 *   const crew = await createGnsCrew({
 *     humanKeypair,
 *     territoryCells: italyGrid.cells,
 *     manager: {
 *       role: 'Grid Operations Manager',
 *       goal: 'Orchestrate monitoring of Italian electricity grid',
 *       tools: [reportingTool],
 *       riskLevel: 'HIGH',
 *     },
 *     workers: [
 *       {
 *         role: 'Sensor Fetcher',
 *         goal: 'Pull real-time sensor data',
 *         tools: [sensorTool],
 *         facets: ['read', 'telemetry'],
 *         riskLevel: 'LOW',
 *       },
 *       {
 *         role: 'Anomaly Detector',
 *         goal: 'Flag voltage anomalies',
 *         tools: [analysisTool],
 *         facets: ['read', 'execute'],
 *         riskLevel: 'MEDIUM',
 *       },
 *     ],
 *     tasks: [
 *       { description: 'Fetch current grid load', assignTo: 'worker:0', requiredFacet: 'telemetry' },
 *       { description: 'Detect anomalies in data', assignTo: 'worker:1', contextPassthrough: true },
 *       { description: 'Summarize findings', assignTo: 'manager' },
 *     ],
 *     llm,
 *     verbose: true,
 *   });
 *
 *   const result = await crew.kickoff();
 *   console.log(result.output);
 *   console.log(result.delegationChainValid); // true
 *   console.log(result.euAiActCompliant);     // true
 */
export async function createGnsCrew(config: GnsCrewConfig): Promise<GnsCrew> {
  return GnsCrew.create(config);
}

// Re-export key types
export type { AgentFacet, RiskLevel, HitlEscalationRequest };
