/**
 * GNSAgentHooks — OpenAI Agents SDK lifecycle hooks with GNS-AIP identity.
 *
 * Extends the AgentHooks class to automatically create breadcrumbs for every
 * agent lifecycle event: start, end, tool calls, handoffs, and errors.
 *
 * Usage:
 *   import { Agent } from '@openai/agents';
 *   import { GNSAgentHooks } from 'openai-gns-aip';
 *
 *   const hooks = await GNSAgentHooks.provision({
 *     backendUrl: 'https://gns-browser-production.up.railway.app',
 *     agentType: 'autonomous',
 *     agentHandle: 'my-openai-agent',
 *     homeCells: ['8a2a1072b59ffff'],
 *   });
 *
 *   await hooks.delegate(principalPk, { scope: { actions: ['search', 'code'] } });
 *
 *   const agent = new Agent({
 *     name: 'My Agent',
 *     instructions: 'You are a helpful assistant',
 *     hooks,
 *   });
 */

import { GNSAgentSDK, DelegationChain } from '@gns-aip/sdk';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GNSHooksProvisionOptions {
  /** GNS backend URL */
  backendUrl: string;
  /** Agent type classification */
  agentType: 'autonomous' | 'supervised' | 'deterministic';
  /** Desired @handle for this agent */
  agentHandle?: string;
  /** H3 cells defining operational territory */
  homeCells?: string[];
  /** Stellar address for staking/payments */
  stellarAddress?: string;
  /** Amount of GNS tokens staked */
  gnsStaked?: number;
  /** Jurisdiction code (ISO 3166) */
  jurisdiction?: string;
}

export interface GNSHooksDelegateOptions {
  /** Scope of delegation */
  scope?: {
    actions?: string[];
    resources?: string[];
  };
  /** H3 cells for territorial scope */
  territory?: string[];
  /** Expiration date for delegation */
  expiresAt?: string;
  /** Maximum sub-delegation depth */
  maxSubdelegationDepth?: number;
}

export interface GNSBreadcrumb {
  h3Cell: string;
  operationType: string;
  operationHash: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface GNSAuditEvent {
  eventType: string;
  timestamp: string;
  runId?: string;
  metadata: Record<string, unknown>;
}

// ─── AgentHooks Implementation ───────────────────────────────────────────────

/**
 * GNSAgentHooks provides GNS-AIP identity and compliance tracking for
 * OpenAI Agents SDK agents via the AgentHooks lifecycle interface.
 *
 * The class implements the AgentHooks interface methods:
 * - onStart: Called when agent begins execution
 * - onEnd: Called when agent completes
 * - onHandoff: Called when control transfers to another agent
 * - onToolStart: Called before a tool executes
 * - onToolEnd: Called after a tool completes
 *
 * Each event creates a breadcrumb that is batched and flushed to the
 * GNS backend for compliance auditing.
 */
export class GNSAgentHooks {
  private sdk: GNSAgentSDK;
  private agentId: string | null = null;
  private agentPk: string | null = null;
  private delegated = false;
  private pendingBreadcrumbs: GNSBreadcrumb[] = [];
  private auditLog: GNSAuditEvent[] = [];
  private flushThreshold: number;
  private defaultH3Cell: string;
  private _sessionStartTime: string;

  constructor(options: {
    sdk: GNSAgentSDK;
    agentId?: string;
    agentPk?: string;
    flushThreshold?: number;
    defaultH3Cell?: string;
  }) {
    this.sdk = options.sdk;
    this.agentId = options.agentId || null;
    this.agentPk = options.agentPk || null;
    this.flushThreshold = options.flushThreshold || 50;
    this.defaultH3Cell = options.defaultH3Cell || '8a2a1072b59ffff';
    this._sessionStartTime = new Date().toISOString();
  }

  // ─── Static Factory ──────────────────────────────────────────────────────

  /**
   * Provision a new agent identity and return configured hooks.
   *
   * @example
   * const hooks = await GNSAgentHooks.provision({
   *   backendUrl: 'https://gns-browser-production.up.railway.app',
   *   agentType: 'autonomous',
   *   agentHandle: 'my-agent',
   *   homeCells: ['8a2a1072b59ffff'],
   * });
   */
  static async provision(options: GNSHooksProvisionOptions): Promise<GNSAgentHooks> {
    const sdk = new GNSAgentSDK({ backendUrl: options.backendUrl });

    const result = await sdk.provisionAgent({
      agentType: options.agentType,
      agentHandle: options.agentHandle,
      homeCells: options.homeCells,
      stellarAddress: options.stellarAddress,
      gnsStaked: options.gnsStaked,
      jurisdiction: options.jurisdiction,
    });

    return new GNSAgentHooks({
      sdk,
      agentId: result.agentId,
      agentPk: result.pkRoot,
      defaultH3Cell: options.homeCells?.[0] || '8a2a1072b59ffff',
    });
  }

  // ─── Delegation ──────────────────────────────────────────────────────────

  /**
   * Delegate this agent to a human principal.
   * Required before the agent can operate at VERIFIED tier or above.
   */
  async delegate(
    principalPk: string,
    options?: GNSHooksDelegateOptions,
  ): Promise<void> {
    if (!this.agentId) throw new Error('Agent not provisioned. Call provision() first.');

    await this.sdk.delegateToAgent({
      principalPk,
      agentId: this.agentId,
      scope: options?.scope,
      territory: options?.territory,
      expiresAt: options?.expiresAt,
      maxSubdelegationDepth: options?.maxSubdelegationDepth,
    });

    this.delegated = true;
  }

  // ─── AgentHooks Lifecycle Methods ────────────────────────────────────────

  /**
   * Called when the agent starts execution.
   * Creates a breadcrumb marking the beginning of the agent run.
   */
  async onStart(context: unknown, agent: unknown): Promise<void> {
    const agentName = this.extractAgentName(agent);
    const runId = this.extractRunId(context);

    await this.recordEvent('agent_start', {
      agentName,
      runId,
      sessionStart: this._sessionStartTime,
    });
  }

  /**
   * Called when the agent produces a final output.
   * Creates a breadcrumb with output metadata (never the actual content).
   */
  async onEnd(context: unknown, agent: unknown, output: unknown): Promise<void> {
    const agentName = this.extractAgentName(agent);
    const runId = this.extractRunId(context);

    await this.recordEvent('agent_end', {
      agentName,
      runId,
      outputType: typeof output,
      outputLength: typeof output === 'string' ? output.length : undefined,
      hasOutput: output !== null && output !== undefined,
    });

    // Auto-flush remaining breadcrumbs at end of run
    await this.flushBreadcrumbs();
  }

  /**
   * Called when a handoff occurs (control transfers to another agent).
   * Creates a breadcrumb documenting the delegation chain event.
   */
  async onHandoff(context: unknown, agent: unknown, source: unknown): Promise<void> {
    const targetName = this.extractAgentName(agent);
    const sourceName = this.extractAgentName(source);
    const runId = this.extractRunId(context);

    await this.recordEvent('agent_handoff', {
      from: sourceName,
      to: targetName,
      runId,
    });
  }

  /**
   * Called immediately before a tool is executed.
   * Creates a breadcrumb with tool identification (never the input data).
   */
  async onToolStart(context: unknown, agent: unknown, tool: unknown): Promise<void> {
    const agentName = this.extractAgentName(agent);
    const toolName = this.extractToolName(tool);
    const runId = this.extractRunId(context);

    await this.recordEvent('tool_start', {
      agentName,
      toolName,
      runId,
    });
  }

  /**
   * Called immediately after a tool finishes execution.
   * Creates a breadcrumb with tool result metadata.
   */
  async onToolEnd(context: unknown, agent: unknown, tool: unknown, result: unknown): Promise<void> {
    const agentName = this.extractAgentName(agent);
    const toolName = this.extractToolName(tool);
    const runId = this.extractRunId(context);

    await this.recordEvent('tool_end', {
      agentName,
      toolName,
      runId,
      resultType: typeof result,
      resultLength: typeof result === 'string' ? result.length : undefined,
    });
  }

  // ─── Breadcrumb Management ───────────────────────────────────────────────

  /**
   * Record an event as both an audit log entry and a pending breadcrumb.
   * Auto-flushes when the threshold is reached.
   */
  private async recordEvent(
    eventType: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const operationHash = this.hashOperation(eventType, timestamp, metadata);

    // Audit log (in-memory, full session)
    this.auditLog.push({
      eventType,
      timestamp,
      runId: metadata.runId as string | undefined,
      metadata,
    });

    // Breadcrumb for backend submission
    this.pendingBreadcrumbs.push({
      h3Cell: this.defaultH3Cell,
      operationType: eventType,
      operationHash,
      timestamp,
      metadata: {
        ...metadata,
        // Privacy: strip any potentially sensitive fields
        agentId: this.agentId,
      },
    });

    if (this.pendingBreadcrumbs.length >= this.flushThreshold) {
      await this.flushBreadcrumbs();
    }
  }

  /**
   * Flush all pending breadcrumbs to the GNS backend.
   */
  async flushBreadcrumbs(): Promise<{ accepted: number; rejected: number } | null> {
    if (!this.agentId || this.pendingBreadcrumbs.length === 0) {
      return null;
    }

    try {
      const result = await this.sdk.submitBreadcrumbs(
        this.agentId,
        this.pendingBreadcrumbs,
      );
      this.pendingBreadcrumbs = [];
      return result;
    } catch (error) {
      // Don't throw — breadcrumb failures should not break agent execution
      console.warn('[GNS-AIP] Failed to flush breadcrumbs:', error);
      return null;
    }
  }

  // ─── Compliance Queries ──────────────────────────────────────────────────

  /**
   * Get the current compliance score for this agent.
   */
  async getCompliance(): Promise<unknown> {
    if (!this.agentId) throw new Error('Agent not provisioned');
    return this.sdk.getCompliance(this.agentId);
  }

  /**
   * Get the full public manifest for this agent.
   */
  async getManifest(): Promise<unknown> {
    if (!this.agentId) throw new Error('Agent not provisioned');
    return this.sdk.getAgentManifest(this.agentId);
  }

  /**
   * Verify the delegation chain back to a human root.
   */
  async verifyDelegation(): Promise<unknown> {
    if (!this.agentId) throw new Error('Agent not provisioned');
    return DelegationChain.verify(this.sdk, this.agentId);
  }

  /**
   * Check if a specific action is authorized by the delegation scope.
   */
  async checkAction(action: string): Promise<{ authorized: boolean; reason: string }> {
    if (!this.agentId) throw new Error('Agent not provisioned');
    return DelegationChain.checkScope(this.sdk, this.agentId, action);
  }

  // ─── Audit Log ───────────────────────────────────────────────────────────

  /**
   * Get the in-memory audit log for this session.
   */
  getAuditLog(options?: {
    eventTypes?: string[];
    since?: string;
  }): GNSAuditEvent[] {
    let events = [...this.auditLog];

    if (options?.eventTypes) {
      events = events.filter((e) => options.eventTypes!.includes(e.eventType));
    }

    if (options?.since) {
      const since = new Date(options.since).getTime();
      events = events.filter((e) => new Date(e.timestamp).getTime() >= since);
    }

    return events;
  }

  /**
   * Generate a compliance audit report for this session.
   */
  generateAuditReport(): {
    agentId: string | null;
    sessionStart: string;
    totalEvents: number;
    eventSummary: Record<string, number>;
    pendingBreadcrumbs: number;
    delegated: boolean;
  } {
    const eventSummary: Record<string, number> = {};
    for (const event of this.auditLog) {
      eventSummary[event.eventType] = (eventSummary[event.eventType] || 0) + 1;
    }

    return {
      agentId: this.agentId,
      sessionStart: this._sessionStartTime,
      totalEvents: this.auditLog.length,
      eventSummary,
      pendingBreadcrumbs: this.pendingBreadcrumbs.length,
      delegated: this.delegated,
    };
  }

  // ─── Getters ─────────────────────────────────────────────────────────────

  get id(): string | null {
    return this.agentId;
  }

  get publicKey(): string | null {
    return this.agentPk;
  }

  get isDelegated(): boolean {
    return this.delegated;
  }

  get pendingCount(): number {
    return this.pendingBreadcrumbs.length;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  private extractAgentName(agent: unknown): string {
    if (agent && typeof agent === 'object' && 'name' in agent) {
      return String((agent as { name: string }).name);
    }
    return 'unknown';
  }

  private extractToolName(tool: unknown): string {
    if (tool && typeof tool === 'object' && 'name' in tool) {
      return String((tool as { name: string }).name);
    }
    return 'unknown';
  }

  private extractRunId(context: unknown): string | undefined {
    if (context && typeof context === 'object') {
      const ctx = context as Record<string, unknown>;
      if ('runId' in ctx) return String(ctx.runId);
      if ('run_id' in ctx) return String(ctx.run_id);
      if ('id' in ctx) return String(ctx.id);
    }
    return undefined;
  }

  private hashOperation(
    eventType: string,
    timestamp: string,
    metadata: Record<string, unknown>,
  ): string {
    // Simple deterministic hash for breadcrumb identification
    const payload = `${eventType}:${timestamp}:${JSON.stringify(metadata)}`;
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return `oai-${Math.abs(hash).toString(16).padStart(8, '0')}`;
  }
}
