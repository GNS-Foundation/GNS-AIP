/**
 * GNSIdentityProvider — One-call setup for GNS-AIP with Vercel AI SDK.
 *
 * Provisions an agent identity, sets up compliance middleware and delegation
 * tool in a single factory call. This is the recommended entry point.
 *
 * Usage:
 *   import { wrapLanguageModel, generateText } from 'ai';
 *   import { openai } from '@ai-sdk/openai';
 *   import { GNSIdentityProvider } from 'vercel-gns-aip';
 *
 *   const gns = await GNSIdentityProvider.create({
 *     backendUrl: 'https://gns-browser-production.up.railway.app',
 *     agentType: 'autonomous',
 *     agentHandle: 'my-nextjs-agent',
 *     homeCells: ['8a2a1072b59ffff'],
 *   });
 *
 *   // Delegate to human
 *   await gns.delegate('ed25519-human-public-key', {
 *     scope: { actions: ['search', 'code'] },
 *   });
 *
 *   // Wrap any model
 *   const model = wrapLanguageModel({
 *     model: openai('gpt-4o'),
 *     middleware: gns.middleware,
 *   });
 *
 *   // Use with delegation tool
 *   const result = await generateText({
 *     model,
 *     prompt: 'Search for EU AI Act requirements',
 *     tools: { gns_check_delegation: gns.delegationTool },
 *   });
 */

import { GNSAgentSDK, DelegationChain } from '@gns-aip/sdk';
import { createGNSComplianceMiddleware, GNSComplianceMiddleware } from './GNSComplianceMiddleware';
import { createGNSDelegationTool } from './GNSDelegationTool';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GNSProviderCreateOptions {
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
  /** Minimum compliance tier for the guardrail (optional) */
  minimumTier?: 'SHADOW' | 'BASIC' | 'VERIFIED' | 'TRUSTED' | 'SOVEREIGN';
  /** Enable debug logging */
  debug?: boolean;
}

export interface GNSProviderDelegateOptions {
  /** Scope of delegation */
  scope?: {
    actions?: string[];
    resources?: string[];
  };
  /** H3 cells for territorial scope */
  territory?: string[];
  /** Expiration date */
  expiresAt?: string;
  /** Max sub-delegation depth */
  maxSubdelegationDepth?: number;
}

// ─── Provider Class ──────────────────────────────────────────────────────────

export class GNSIdentityProvider {
  private sdk: GNSAgentSDK;
  private _agentId: string;
  private _agentPk: string;
  private _delegated = false;
  private _middleware: GNSComplianceMiddleware;
  private _delegationTool: ReturnType<typeof createGNSDelegationTool>;

  private constructor(
    sdk: GNSAgentSDK,
    agentId: string,
    agentPk: string,
    middleware: GNSComplianceMiddleware,
    delegationTool: ReturnType<typeof createGNSDelegationTool>,
  ) {
    this.sdk = sdk;
    this._agentId = agentId;
    this._agentPk = agentPk;
    this._middleware = middleware;
    this._delegationTool = delegationTool;
  }

  /**
   * Provision a new agent identity and create all GNS-AIP integrations.
   *
   * Returns a GNSIdentityProvider with:
   * - `.middleware` — Language Model Middleware for wrapLanguageModel()
   * - `.delegationTool` — Tool for tools parameter
   * - `.delegate()` — Delegate to human principal
   * - `.compliance` — Query compliance score
   * - `.manifest` — Query agent manifest
   */
  static async create(options: GNSProviderCreateOptions): Promise<GNSIdentityProvider> {
    const sdk = new GNSAgentSDK({ backendUrl: options.backendUrl });

    // 1. Provision agent identity
    const result = await sdk.provisionAgent({
      agentType: options.agentType,
      agentHandle: options.agentHandle,
      homeCells: options.homeCells,
      stellarAddress: options.stellarAddress,
      gnsStaked: options.gnsStaked,
      jurisdiction: options.jurisdiction,
    });

    // 2. Create compliance middleware
    const middleware = createGNSComplianceMiddleware({
      sdk,
      agentId: result.agentId,
      defaultH3Cell: options.homeCells?.[0],
      minimumTier: options.minimumTier,
      debug: options.debug,
    });

    // 3. Create delegation tool
    const delegationTool = createGNSDelegationTool({
      sdk,
      agentId: result.agentId,
    });

    return new GNSIdentityProvider(sdk, result.agentId, result.pkRoot, middleware, delegationTool);
  }

  // ─── Delegation ──────────────────────────────────────────────────────

  /**
   * Delegate this agent to a human principal.
   */
  async delegate(principalPk: string, options?: GNSProviderDelegateOptions): Promise<void> {
    await this.sdk.delegateToAgent({
      principalPk,
      agentId: this._agentId,
      scope: options?.scope,
      territory: options?.territory,
      expiresAt: options?.expiresAt,
      maxSubdelegationDepth: options?.maxSubdelegationDepth,
    });
    this._delegated = true;
  }

  // ─── Accessors ───────────────────────────────────────────────────────

  /** The compliance middleware — pass to wrapLanguageModel() */
  get middleware(): GNSComplianceMiddleware {
    return this._middleware;
  }

  /** The delegation tool — add to tools parameter */
  get delegationTool(): ReturnType<typeof createGNSDelegationTool> {
    return this._delegationTool;
  }

  /** Agent ID */
  get agentId(): string {
    return this._agentId;
  }

  /** Agent public key (Ed25519) */
  get publicKey(): string {
    return this._agentPk;
  }

  /** Whether delegation has been performed */
  get isDelegated(): boolean {
    return this._delegated;
  }

  // ─── Queries ─────────────────────────────────────────────────────────

  /** Get current compliance score */
  async getCompliance(): Promise<unknown> {
    return this.sdk.getCompliance(this._agentId);
  }

  /** Get agent manifest */
  async getManifest(): Promise<unknown> {
    return this.sdk.getAgentManifest(this._agentId);
  }

  /** Verify delegation chain */
  async verifyDelegation(): Promise<unknown> {
    return DelegationChain.verify(this.sdk, this._agentId);
  }

  /** Check if action is authorized */
  async checkAction(action: string): Promise<{ authorized: boolean; reason: string }> {
    return DelegationChain.checkScope(this.sdk, this._agentId, action);
  }

  /** Flush pending breadcrumbs from the middleware */
  async flush(): Promise<unknown> {
    return this._middleware.flush();
  }

  /** Get middleware statistics */
  getStats() {
    return this._middleware.getStats();
  }
}
