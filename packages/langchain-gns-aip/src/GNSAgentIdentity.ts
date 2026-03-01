// =================================================================
// langchain-gns-aip / GNSAgentIdentity
// Deliverable 5.1-01: Wrapper class around any LangChain agent
//
// Usage (3 lines — the golden rule):
//   const identity = await GNSAgentIdentity.provision({ ... });
//   await identity.delegate(principalPk, scope);
//   const agent = identity.wrap(myLangChainAgent);
// =================================================================

import type { Runnable, RunnableConfig } from '@langchain/core/runnables';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import {
  AgentIdentity,
  DelegationCert,
  ComplianceScore,
  VirtualBreadcrumb,
  AgentManifest,
} from '@gns-aip/sdk';

import { GNSComplianceCallback } from './GNSComplianceCallback';
import { createGNSDelegationTool } from './GNSDelegationTool';

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

export interface GNSProvisionOptions {
  /** Agent type classification */
  agentType: 'autonomous' | 'semi_autonomous' | 'tool';

  /** H3 cells defining operational territory */
  homeCells: string[];

  /** GNS-AIP backend URL (defaults to production) */
  apiUrl?: string;

  /** Optional agent handle (e.g. "mybot") */
  handle?: string;

  /** Optional jurisdiction code (e.g. "EU", "US-CA") */
  jurisdiction?: string;

  /** Custom manifest fields */
  manifest?: Record<string, unknown>;

  /** Existing Ed25519 keypair (hex). If omitted, generates new one. */
  secretKey?: string;
}

export interface GNSDelegateOptions {
  /** Scope of delegation (actions the agent may perform) */
  scope: Record<string, unknown>;

  /** Territory override (defaults to agent's home_cells) */
  territory?: string[];

  /** Expiration (ISO string or Date). Default: 30 days */
  expiresAt?: string | Date;

  /** Max depth for subdelegation. Default: 0 (no subdelegation) */
  maxSubdelegationDepth?: number;

  /** Policy when agent attempts to escalate beyond scope */
  escalationPolicy?: 'notify' | 'require_approval' | 'deny';
}

export interface GNSWrapOptions {
  /** Automatically create virtual breadcrumbs for each invocation */
  autoBreadcrumb?: boolean;

  /** Include GNSDelegationTool in the agent's tool belt */
  includeDelegationTool?: boolean;

  /** Flush breadcrumbs to backend after this many accumulate */
  breadcrumbFlushThreshold?: number;

  /** Custom callback handlers to merge alongside the compliance callback */
  additionalCallbacks?: BaseCallbackHandler[];
}

// -----------------------------------------------------------------
// GNSAgentIdentity
// -----------------------------------------------------------------

export class GNSAgentIdentity {
  /** The underlying SDK identity object */
  readonly identity: AgentIdentity;

  /** The active delegation certificate (null until delegate() is called) */
  private _delegation: DelegationCert | null = null;

  /** Latest compliance score snapshot */
  private _compliance: ComplianceScore | null = null;

  /** Accumulated breadcrumbs waiting to be flushed */
  private _breadcrumbBuffer: VirtualBreadcrumb[] = [];

  /** Backend API base URL */
  private readonly _apiUrl: string;

  /** Invocation counter for sequence numbering */
  private _invocationSeq = 0;

  // ---------------------------------------------------------------
  // Construction (use static provision() instead)
  // ---------------------------------------------------------------

  private constructor(identity: AgentIdentity, apiUrl: string) {
    this.identity = identity;
    this._apiUrl = apiUrl;
  }

  // ---------------------------------------------------------------
  // Static Factory — Provision
  // ---------------------------------------------------------------

  /**
   * Provision a new GNS-AIP agent identity.
   * One function call — the first of the three golden steps.
   */
  static async provision(opts: GNSProvisionOptions): Promise<GNSAgentIdentity> {
    const apiUrl = opts.apiUrl ?? 'https://gns-browser-production.up.railway.app';

    // Create identity via SDK
    const identity = await AgentIdentity.create({
      agentType: opts.agentType,
      homeCells: opts.homeCells,
      jurisdiction: opts.jurisdiction,
      manifest: opts.manifest ?? {},
      secretKey: opts.secretKey,
    });

    // Register with backend
    const resp = await fetch(`${apiUrl}/agents/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pk_root: identity.publicKey,
        agent_type: opts.agentType,
        principal_pk: identity.publicKey, // self-referential until delegation
        home_cells: opts.homeCells,
        handle: opts.handle,
        jurisdiction: opts.jurisdiction,
        manifest: opts.manifest ?? {},
        signature: identity.sign(JSON.stringify({
          pk_root: identity.publicKey,
          agent_type: opts.agentType,
          home_cells: opts.homeCells,
        })),
      }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(
        `GNS-AIP provision failed (${resp.status}): ${(body as Record<string, string>).error ?? resp.statusText}`
      );
    }

    return new GNSAgentIdentity(identity, apiUrl);
  }

  /**
   * Restore an existing agent identity from a secret key.
   * Skips backend provisioning (agent already registered).
   */
  static async fromSecretKey(
    secretKey: string,
    apiUrl?: string
  ): Promise<GNSAgentIdentity> {
    const url = apiUrl ?? 'https://gns-browser-production.up.railway.app';
    const identity = AgentIdentity.fromSecretKey(secretKey);
    return new GNSAgentIdentity(identity, url);
  }

  // ---------------------------------------------------------------
  // Delegate — link agent to human principal
  // ---------------------------------------------------------------

  /**
   * Create a delegation certificate linking this agent to a human principal.
   * One function call — the second of the three golden steps.
   */
  async delegate(
    principalPk: string,
    opts: GNSDelegateOptions
  ): Promise<DelegationCert> {
    const expiresAt = opts.expiresAt
      ? (opts.expiresAt instanceof Date
          ? opts.expiresAt.toISOString()
          : opts.expiresAt)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const cert = DelegationCert.create({
      delegatorPk: principalPk,
      delegatePk: this.identity.publicKey,
      scope: opts.scope,
      territory: opts.territory ?? this.identity.homeCells,
      expiresAt,
      maxSubdelegationDepth: opts.maxSubdelegationDepth ?? 0,
      escalationPolicy: opts.escalationPolicy ?? 'notify',
    });

    // Submit to backend
    const resp = await fetch(`${this._apiUrl}/agents/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        delegator_pk: principalPk,
        delegate_pk: this.identity.publicKey,
        scope: opts.scope,
        territory: opts.territory ?? this.identity.homeCells,
        expires_at: expiresAt,
        max_subdelegation_depth: opts.maxSubdelegationDepth ?? 0,
        escalation_policy: opts.escalationPolicy ?? 'notify',
        cert_hash: cert.hash,
        delegator_sig: cert.delegatorSig,
      }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(
        `GNS-AIP delegate failed (${resp.status}): ${(body as Record<string, string>).error ?? resp.statusText}`
      );
    }

    this._delegation = cert;
    return cert;
  }

  // ---------------------------------------------------------------
  // Wrap — attach identity to a LangChain Runnable
  // ---------------------------------------------------------------

  /**
   * Wrap any LangChain Runnable with GNS-AIP compliance tracking.
   * Returns a new Runnable that automatically logs breadcrumbs.
   * The third of the three golden steps.
   */
  wrap<TInput, TOutput>(
    runnable: Runnable<TInput, TOutput>,
    opts: GNSWrapOptions = {}
  ): Runnable<TInput, TOutput> {
    const {
      autoBreadcrumb = true,
      breadcrumbFlushThreshold = 50,
      additionalCallbacks = [],
    } = opts;

    // Build compliance callback
    const complianceCallback = new GNSComplianceCallback({
      identity: this,
      autoBreadcrumb,
      flushThreshold: breadcrumbFlushThreshold,
    });

    const callbacks: BaseCallbackHandler[] = [
      complianceCallback as unknown as BaseCallbackHandler,
      ...additionalCallbacks,
    ];

    // Wrap with config that injects our callbacks
    return runnable.withConfig({
      callbacks,
      metadata: {
        gns_agent_pk: this.identity.publicKey,
        gns_agent_type: this.identity.agentType,
        gns_delegation_active: this._delegation !== null,
        gns_compliance_tier: this._compliance?.tier ?? 'unverified',
      },
    } as RunnableConfig);
  }

  // ---------------------------------------------------------------
  // Breadcrumb Management
  // ---------------------------------------------------------------

  /**
   * Record a virtual breadcrumb for an agent operation.
   */
  recordBreadcrumb(operationType: string, operationHash: string, h3Cell?: string): VirtualBreadcrumb {
    this._invocationSeq++;
    const breadcrumb = VirtualBreadcrumb.create({
      agentPk: this.identity.publicKey,
      h3Cell: h3Cell ?? this.identity.homeCells[0] ?? '8a2a1072b59ffff',
      operationType,
      operationHash,
      sequenceNum: this._invocationSeq,
      prevHash: this._breadcrumbBuffer.length > 0
        ? this._breadcrumbBuffer[this._breadcrumbBuffer.length - 1].hash
        : undefined,
    });

    this._breadcrumbBuffer.push(breadcrumb);
    return breadcrumb;
  }

  /**
   * Flush accumulated breadcrumbs to the GNS-AIP backend.
   */
  async flushBreadcrumbs(): Promise<{ stored: number; violations: number }> {
    if (this._breadcrumbBuffer.length === 0) {
      return { stored: 0, violations: 0 };
    }

    const breadcrumbs = this._breadcrumbBuffer.map(b => ({
      h3_cell: b.h3Cell,
      operation_type: b.operationType,
      operation_hash: b.operationHash,
      sequence_num: b.sequenceNum,
      prev_hash: b.prevHash,
      breadcrumb_hash: b.hash,
      within_territory: this.identity.homeCells.includes(b.h3Cell),
      signature: this.identity.sign(b.hash),
      timestamp: b.timestamp,
    }));

    const resp = await fetch(
      `${this._apiUrl}/agents/${this.identity.publicKey}/breadcrumbs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ breadcrumbs }),
      }
    );

    if (!resp.ok) {
      throw new Error(`Breadcrumb flush failed (${resp.status})`);
    }

    const data = await resp.json() as {
      data?: { breadcrumbs_stored?: number; violations?: number };
    };
    this._breadcrumbBuffer = [];

    return {
      stored: data.data?.breadcrumbs_stored ?? breadcrumbs.length,
      violations: data.data?.violations ?? 0,
    };
  }

  // ---------------------------------------------------------------
  // Compliance
  // ---------------------------------------------------------------

  /**
   * Fetch or recalculate the agent's compliance score.
   */
  async getCompliance(recalculate = false): Promise<ComplianceScore> {
    const url = new URL(
      `/agents/${this.identity.publicKey}/compliance`,
      this._apiUrl
    );
    if (recalculate) url.searchParams.set('recalculate', 'true');

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      throw new Error(`Compliance fetch failed (${resp.status})`);
    }

    const body = await resp.json() as { data: ComplianceScore };
    this._compliance = body.data;
    return body.data;
  }

  /**
   * Get the agent's public manifest.
   */
  async getManifest(): Promise<AgentManifest> {
    const resp = await fetch(
      `${this._apiUrl}/agents/${this.identity.publicKey}/manifest`
    );
    if (!resp.ok) {
      throw new Error(`Manifest fetch failed (${resp.status})`);
    }

    const body = await resp.json() as { data: AgentManifest };
    return body.data;
  }

  // ---------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------

  get publicKey(): string {
    return this.identity.publicKey;
  }

  get delegation(): DelegationCert | null {
    return this._delegation;
  }

  get compliance(): ComplianceScore | null {
    return this._compliance;
  }

  get apiUrl(): string {
    return this._apiUrl;
  }

  get bufferedBreadcrumbs(): number {
    return this._breadcrumbBuffer.length;
  }

  /**
   * Create a LangChain tool that lets the agent check its own delegation.
   */
  createDelegationTool() {
    return createGNSDelegationTool(this);
  }
}
