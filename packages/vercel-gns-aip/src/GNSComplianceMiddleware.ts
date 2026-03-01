/**
 * GNSComplianceMiddleware — Vercel AI SDK Language Model Middleware.
 *
 * Intercepts all generateText / streamText / generateObject calls to create
 * GNS-AIP breadcrumbs for every LLM interaction. Uses the stable
 * LanguageModelV3Middleware interface.
 *
 * Usage:
 *   import { wrapLanguageModel, generateText } from 'ai';
 *   import { createGNSComplianceMiddleware } from 'vercel-gns-aip';
 *
 *   const middleware = await createGNSComplianceMiddleware({
 *     backendUrl: 'https://gns-browser-production.up.railway.app',
 *     agentId: 'agent-001',
 *   });
 *
 *   const model = wrapLanguageModel({
 *     model: openai('gpt-4o'),
 *     middleware,
 *   });
 *
 *   const result = await generateText({ model, prompt: 'Hello' });
 *
 * Privacy by design:
 * - NEVER logs prompts, completions, or tool inputs/outputs
 * - Only records: model name, token counts, timing, error status
 * - All content is hashed, never stored
 */

import { GNSAgentSDK, DelegationChain } from '@gns-aip/sdk';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GNSMiddlewareOptions {
  /** GNS backend URL */
  backendUrl?: string;
  /** Pre-configured SDK instance */
  sdk?: GNSAgentSDK;
  /** Provisioned agent ID */
  agentId: string;
  /** Default H3 cell for breadcrumb location */
  defaultH3Cell?: string;
  /** Auto-flush breadcrumbs after each call (default: true) */
  autoFlush?: boolean;
  /** Batch size before forced flush (default: 50) */
  flushThreshold?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Minimum compliance tier to allow calls (optional guardrail) */
  minimumTier?: 'SHADOW' | 'BASIC' | 'VERIFIED' | 'TRUSTED' | 'SOVEREIGN';
}

export interface GNSMiddlewareBreadcrumb {
  h3Cell: string;
  operationType: string;
  operationHash: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface GNSMiddlewareStats {
  totalCalls: number;
  generateCalls: number;
  streamCalls: number;
  totalTokens: number;
  errors: number;
  pendingBreadcrumbs: number;
  lastCallTimestamp: string | null;
}

// ─── Middleware Factory ──────────────────────────────────────────────────────

/**
 * Create a GNS-AIP compliance middleware for the Vercel AI SDK.
 *
 * Returns a LanguageModelV3Middleware-compatible object that can be passed
 * to `wrapLanguageModel()`.
 *
 * @example
 * const middleware = createGNSComplianceMiddleware({
 *   backendUrl: 'https://gns-browser-production.up.railway.app',
 *   agentId: 'agent-001',
 * });
 *
 * const model = wrapLanguageModel({ model: openai('gpt-4o'), middleware });
 */
export function createGNSComplianceMiddleware(options: GNSMiddlewareOptions) {
  const sdk = options.sdk || new GNSAgentSDK({ backendUrl: options.backendUrl || '' });
  const agentId = options.agentId;
  const defaultH3Cell = options.defaultH3Cell || '8a2a1072b59ffff';
  const autoFlush = options.autoFlush !== false;
  const flushThreshold = options.flushThreshold || 50;
  const debug = options.debug || false;
  const minimumTier = options.minimumTier;
  const tierOrder = ['SHADOW', 'BASIC', 'VERIFIED', 'TRUSTED', 'SOVEREIGN'];

  // Internal state
  const pendingBreadcrumbs: GNSMiddlewareBreadcrumb[] = [];
  const stats: GNSMiddlewareStats = {
    totalCalls: 0,
    generateCalls: 0,
    streamCalls: 0,
    totalTokens: 0,
    errors: 0,
    pendingBreadcrumbs: 0,
    lastCallTimestamp: null,
  };

  // ─── Helper Functions ────────────────────────────────────────────────

  function hashOperation(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return `vai-${Math.abs(hash).toString(16).padStart(8, '0')}`;
  }

  function recordBreadcrumb(
    operationType: string,
    metadata: Record<string, unknown>,
  ): void {
    const timestamp = new Date().toISOString();
    pendingBreadcrumbs.push({
      h3Cell: defaultH3Cell,
      operationType,
      operationHash: hashOperation(`${operationType}:${timestamp}:${JSON.stringify(metadata)}`),
      timestamp,
      metadata: { ...metadata, agentId },
    });
    stats.pendingBreadcrumbs = pendingBreadcrumbs.length;
    stats.lastCallTimestamp = timestamp;
  }

  async function flushBreadcrumbs(): Promise<{ accepted: number; rejected: number } | null> {
    if (pendingBreadcrumbs.length === 0) return null;

    const batch = pendingBreadcrumbs.splice(0, pendingBreadcrumbs.length);
    stats.pendingBreadcrumbs = 0;

    try {
      const result = await sdk.submitBreadcrumbs(agentId, batch);
      if (debug) console.log(`[GNS-AIP] Flushed ${batch.length} breadcrumbs`);
      return result;
    } catch (error) {
      stats.errors++;
      // Re-queue on failure (bounded)
      if (pendingBreadcrumbs.length + batch.length <= flushThreshold * 2) {
        pendingBreadcrumbs.push(...batch);
        stats.pendingBreadcrumbs = pendingBreadcrumbs.length;
      }
      console.warn('[GNS-AIP] Flush failed:', error);
      return null;
    }
  }

  async function checkTierGuardrail(): Promise<void> {
    if (!minimumTier) return;

    try {
      const compliance = (await sdk.getCompliance(agentId)) as Record<string, unknown>;
      const currentTier = (compliance.tier as string) || 'SHADOW';
      const currentIndex = tierOrder.indexOf(currentTier);
      const minimumIndex = tierOrder.indexOf(minimumTier);

      if (currentIndex < minimumIndex) {
        throw new Error(
          `GNS-AIP: Agent compliance tier ${currentTier} is below minimum ${minimumTier}. ` +
            'Call blocked by compliance guardrail.',
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('GNS-AIP:')) {
        throw error;
      }
      // Network errors — fail open with warning
      console.warn('[GNS-AIP] Compliance check failed, allowing call:', error);
    }
  }

  function extractSafeUsage(result: unknown): Record<string, unknown> {
    const safe: Record<string, unknown> = {};
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;

      // Token usage
      if (r.usage && typeof r.usage === 'object') {
        const usage = r.usage as Record<string, unknown>;
        safe.promptTokens = usage.promptTokens ?? usage.prompt_tokens;
        safe.completionTokens = usage.completionTokens ?? usage.completion_tokens;
        safe.totalTokens = usage.totalTokens ?? usage.total_tokens;

        const total = Number(safe.totalTokens || 0);
        if (total > 0) stats.totalTokens += total;
      }

      // Response metadata (safe — no content)
      if (r.modelId) safe.modelId = r.modelId;
      if (r.finishReason) safe.finishReason = r.finishReason;

      // Warnings (safe — structural info only)
      if (r.warnings && Array.isArray(r.warnings)) {
        safe.warningCount = r.warnings.length;
      }

      // Tool calls (safe — names only, never inputs/outputs)
      if (r.toolCalls && Array.isArray(r.toolCalls)) {
        safe.toolCallCount = r.toolCalls.length;
        safe.toolNames = r.toolCalls.map((tc: Record<string, unknown>) => tc.toolName || tc.name).filter(Boolean);
      }
    }
    return safe;
  }

  function extractSafeParams(params: unknown): Record<string, unknown> {
    const safe: Record<string, unknown> = {};
    if (params && typeof params === 'object') {
      const p = params as Record<string, unknown>;
      // Safe: model config, never content
      if (p.maxTokens) safe.maxTokens = p.maxTokens;
      if (p.temperature) safe.temperature = p.temperature;
      if (p.topP) safe.topP = p.topP;
      if (p.topK) safe.topK = p.topK;
      if (p.frequencyPenalty) safe.frequencyPenalty = p.frequencyPenalty;
      if (p.presencePenalty) safe.presencePenalty = p.presencePenalty;
      if (p.seed) safe.seed = p.seed;

      // Count messages, never log them
      if (p.prompt && Array.isArray(p.prompt)) {
        safe.messageCount = p.prompt.length;
      }

      // Count tools configured, never log schemas
      if (p.tools && typeof p.tools === 'object') {
        safe.toolCount = Object.keys(p.tools).length;
      }

      // Mode
      if (p.mode) safe.mode = typeof p.mode === 'string' ? p.mode : (p.mode as Record<string, unknown>).type;
    }
    return safe;
  }

  // ─── The Middleware Object ───────────────────────────────────────────

  const middleware = {
    /**
     * Transform parameters before they reach the model.
     * Used for compliance tier guardrail checks.
     */
    transformParams: async ({ type, params }: { type: string; params: unknown }) => {
      await checkTierGuardrail();

      const safeParams = extractSafeParams(params);
      recordBreadcrumb('vai_params', {
        callType: type,
        ...safeParams,
      });

      if (debug) {
        console.log(`[GNS-AIP] ${type} call — ${safeParams.messageCount || 0} messages`);
      }

      return params;
    },

    /**
     * Wrap the doGenerate method to track non-streaming calls.
     */
    wrapGenerate: async ({
      doGenerate,
      params,
    }: {
      doGenerate: () => Promise<unknown>;
      params: unknown;
      model: unknown;
    }) => {
      stats.totalCalls++;
      stats.generateCalls++;

      const startTime = Date.now();

      try {
        const result = await doGenerate();
        const durationMs = Date.now() - startTime;
        const usage = extractSafeUsage(result);

        recordBreadcrumb('vai_generate', {
          durationMs,
          ...usage,
        });

        if (autoFlush || pendingBreadcrumbs.length >= flushThreshold) {
          await flushBreadcrumbs();
        }

        return result;
      } catch (error) {
        stats.errors++;
        const durationMs = Date.now() - startTime;

        recordBreadcrumb('vai_generate_error', {
          durationMs,
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
          // Never log error messages — may contain user content
        });

        if (autoFlush) await flushBreadcrumbs();
        throw error;
      }
    },

    /**
     * Wrap the doStream method to track streaming calls.
     */
    wrapStream: async ({
      doStream,
      params,
    }: {
      doStream: () => Promise<unknown>;
      params: unknown;
      model: unknown;
    }) => {
      stats.totalCalls++;
      stats.streamCalls++;

      const startTime = Date.now();

      try {
        const result = await doStream();
        const durationMs = Date.now() - startTime;

        recordBreadcrumb('vai_stream_start', {
          durationMs,
          // Token counts not available until stream completes
        });

        if (pendingBreadcrumbs.length >= flushThreshold) {
          await flushBreadcrumbs();
        }

        return result;
      } catch (error) {
        stats.errors++;
        const durationMs = Date.now() - startTime;

        recordBreadcrumb('vai_stream_error', {
          durationMs,
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        });

        if (autoFlush) await flushBreadcrumbs();
        throw error;
      }
    },
  };

  // ─── Extended Middleware with GNS-AIP methods ────────────────────────

  return Object.assign(middleware, {
    /** Manually flush pending breadcrumbs */
    flush: flushBreadcrumbs,

    /** Get middleware statistics */
    getStats: (): GNSMiddlewareStats => ({ ...stats }),

    /** Get the agent ID this middleware is tracking */
    getAgentId: (): string => agentId,

    /** Verify the delegation chain */
    verifyDelegation: async () => DelegationChain.verify(sdk, agentId),

    /** Check if a specific action is authorized */
    checkAction: async (action: string) => DelegationChain.checkScope(sdk, agentId, action),

    /** Get the current compliance score */
    getCompliance: async () => sdk.getCompliance(agentId),

    /** Get the agent manifest */
    getManifest: async () => sdk.getAgentManifest(agentId),
  });
}

/** Type for the extended middleware returned by createGNSComplianceMiddleware */
export type GNSComplianceMiddleware = ReturnType<typeof createGNSComplianceMiddleware>;
