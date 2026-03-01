// =================================================================
// langchain-gns-aip / GNSComplianceCallback
// Deliverable 5.1-02: LangChain callback handler for audit logging
//
// Hooks into every chain/LLM/tool/agent event and automatically
// creates GNS-AIP virtual breadcrumbs, building the compliance
// trail that feeds the TierGate scoring algorithm.
// =================================================================

import { createHash } from 'crypto';
import type { GNSAgentIdentity } from './GNSAgentIdentity';

// -----------------------------------------------------------------
// Types — LangChain callback event shapes
// -----------------------------------------------------------------

interface SerializedLLM {
  id?: string[];
  type?: string;
  kwargs?: Record<string, unknown>;
  [key: string]: unknown;
}

interface LLMResult {
  generations?: Array<Array<{ text?: string; message?: unknown }>>;
  llmOutput?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AgentAction {
  tool: string;
  toolInput: string | Record<string, unknown>;
  log: string;
  [key: string]: unknown;
}

interface AgentFinish {
  returnValues: Record<string, unknown>;
  log: string;
  [key: string]: unknown;
}

// -----------------------------------------------------------------
// Compliance Callback Options
// -----------------------------------------------------------------

export interface GNSComplianceCallbackOptions {
  /** The GNSAgentIdentity instance to record breadcrumbs for */
  identity: GNSAgentIdentity;

  /** Automatically create breadcrumbs for each LangChain event */
  autoBreadcrumb?: boolean;

  /** Flush to backend after this many breadcrumbs accumulate */
  flushThreshold?: number;

  /** Log events to console (useful for debugging) */
  verbose?: boolean;

  /** Optional H3 cell override (for agents with dynamic territory) */
  h3CellOverride?: string;
}

// -----------------------------------------------------------------
// Audit Event (structured log for each LangChain operation)
// -----------------------------------------------------------------

export interface GNSAuditEvent {
  /** Event type matching LangChain callback method names */
  eventType: string;

  /** SHA-256 hash of the event payload */
  operationHash: string;

  /** ISO timestamp */
  timestamp: string;

  /** LangChain run ID */
  runId: string;

  /** Parent run ID (for nested chains) */
  parentRunId?: string;

  /** Brief payload summary (never includes full prompts/outputs for privacy) */
  summary: Record<string, unknown>;
}

// -----------------------------------------------------------------
// GNSComplianceCallback
// -----------------------------------------------------------------

export class GNSComplianceCallback {
  readonly name = 'GNSComplianceCallback';

  // BaseCallbackHandler flags
  ignoreAgent = false;
  ignoreChain = false;
  ignoreLLM = false;
  ignoreRetriever = false;
  raiseError = false;

  private readonly _identity: GNSAgentIdentity;
  private readonly _autoBreadcrumb: boolean;
  private readonly _flushThreshold: number;
  private readonly _verbose: boolean;
  private readonly _h3Cell?: string;

  /** Running audit log for the session */
  private readonly _auditLog: GNSAuditEvent[] = [];

  constructor(opts: GNSComplianceCallbackOptions) {
    this._identity = opts.identity;
    this._autoBreadcrumb = opts.autoBreadcrumb ?? true;
    this._flushThreshold = opts.flushThreshold ?? 50;
    this._verbose = opts.verbose ?? false;
    this._h3Cell = opts.h3CellOverride;
  }

  // ---------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------

  private _hash(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  private _record(
    eventType: string,
    runId: string,
    parentRunId: string | undefined,
    payload: Record<string, unknown>
  ): void {
    const timestamp = new Date().toISOString();
    const operationHash = this._hash(
      JSON.stringify({ eventType, runId, timestamp, agent: this._identity.publicKey })
    );

    const event: GNSAuditEvent = {
      eventType,
      operationHash,
      timestamp,
      runId,
      parentRunId,
      summary: payload,
    };

    this._auditLog.push(event);

    if (this._verbose) {
      console.log(`[GNS-AIP] ${eventType} | ${operationHash.substring(0, 16)}...`);
    }

    // Record breadcrumb if auto-mode is on
    if (this._autoBreadcrumb) {
      this._identity.recordBreadcrumb(eventType, operationHash, this._h3Cell).catch((err) => {
        if (this._verbose) {
          console.error('[GNS-AIP] Breadcrumb recording failed:', err);
        }
      });

      // Auto-flush when threshold reached
      if (this._identity.bufferedBreadcrumbs >= this._flushThreshold) {
        this._identity.flushBreadcrumbs().catch((err) => {
          if (this._verbose) {
            console.error('[GNS-AIP] Breadcrumb flush failed:', err);
          }
        });
      }
    }
  }

  // ---------------------------------------------------------------
  // LangChain Callback Interface — LLM Events
  // ---------------------------------------------------------------

  handleLLMStart(
    llm: SerializedLLM,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    _metadata?: Record<string, unknown>
  ): void {
    this._record('llm_start', runId, parentRunId, {
      model: llm.id?.join('.') ?? 'unknown',
      promptCount: prompts.length,
      // Never log full prompts — privacy by design
      promptLengths: prompts.map(p => p.length),
    });
  }

  handleLLMEnd(
    output: LLMResult,
    runId: string,
    parentRunId?: string
  ): void {
    const generationCount = output.generations?.length ?? 0;
    this._record('llm_end', runId, parentRunId, {
      generationCount,
      hasOutput: generationCount > 0,
    });
  }

  handleLLMError(
    error: Error,
    runId: string,
    parentRunId?: string
  ): void {
    this._record('llm_error', runId, parentRunId, {
      errorType: error.constructor.name,
      errorMessage: error.message.substring(0, 200),
    });
  }

  handleLLMNewToken(
    _token: string,
    _idx: { prompt: number; completion: number },
    runId: string,
    parentRunId?: string
  ): void {
    // Intentionally no-op for individual tokens to avoid breadcrumb spam.
    // Token-level logging would create thousands of breadcrumbs per invocation.
    // We track LLM start/end instead.
    void runId;
    void parentRunId;
  }

  // ---------------------------------------------------------------
  // LangChain Callback Interface — Chain Events
  // ---------------------------------------------------------------

  handleChainStart(
    chain: SerializedLLM,
    inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    _runType?: string,
    _name?: string
  ): void {
    this._record('chain_start', runId, parentRunId, {
      chainType: chain.id?.join('.') ?? 'unknown',
      inputKeys: Object.keys(inputs),
    });
  }

  handleChainEnd(
    outputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string
  ): void {
    this._record('chain_end', runId, parentRunId, {
      outputKeys: Object.keys(outputs),
    });
  }

  handleChainError(
    error: Error,
    runId: string,
    parentRunId?: string
  ): void {
    this._record('chain_error', runId, parentRunId, {
      errorType: error.constructor.name,
      errorMessage: error.message.substring(0, 200),
    });
  }

  // ---------------------------------------------------------------
  // LangChain Callback Interface — Tool Events
  // ---------------------------------------------------------------

  handleToolStart(
    tool: SerializedLLM,
    input: string,
    runId: string,
    parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    _name?: string
  ): void {
    this._record('tool_start', runId, parentRunId, {
      toolName: tool.id?.join('.') ?? _name ?? 'unknown',
      inputLength: input.length,
    });
  }

  handleToolEnd(
    output: string,
    runId: string,
    parentRunId?: string
  ): void {
    this._record('tool_end', runId, parentRunId, {
      outputLength: output.length,
    });
  }

  handleToolError(
    error: Error,
    runId: string,
    parentRunId?: string
  ): void {
    this._record('tool_error', runId, parentRunId, {
      errorType: error.constructor.name,
      errorMessage: error.message.substring(0, 200),
    });
  }

  // ---------------------------------------------------------------
  // LangChain Callback Interface — Agent Events
  // ---------------------------------------------------------------

  handleAgentAction(
    action: AgentAction,
    runId: string,
    parentRunId?: string
  ): void {
    this._record('agent_action', runId, parentRunId, {
      tool: action.tool,
      inputType: typeof action.toolInput,
    });
  }

  handleAgentEnd(
    finish: AgentFinish,
    runId: string,
    parentRunId?: string
  ): void {
    this._record('agent_end', runId, parentRunId, {
      returnKeys: Object.keys(finish.returnValues),
    });
  }

  // ---------------------------------------------------------------
  // LangChain Callback Interface — Retriever Events
  // ---------------------------------------------------------------

  handleRetrieverStart(
    retriever: SerializedLLM,
    query: string,
    runId: string,
    parentRunId?: string
  ): void {
    this._record('retriever_start', runId, parentRunId, {
      retrieverType: retriever.id?.join('.') ?? 'unknown',
      queryLength: query.length,
    });
  }

  handleRetrieverEnd(
    documents: unknown[],
    runId: string,
    parentRunId?: string
  ): void {
    this._record('retriever_end', runId, parentRunId, {
      documentCount: documents.length,
    });
  }

  handleRetrieverError(
    error: Error,
    runId: string,
    parentRunId?: string
  ): void {
    this._record('retriever_error', runId, parentRunId, {
      errorType: error.constructor.name,
      errorMessage: error.message.substring(0, 200),
    });
  }

  // ---------------------------------------------------------------
  // Chat Model Events (newer LangChain interface)
  // ---------------------------------------------------------------

  handleChatModelStart(
    llm: SerializedLLM,
    messages: unknown[][],
    runId: string,
    parentRunId?: string
  ): void {
    this._record('chat_model_start', runId, parentRunId, {
      model: llm.id?.join('.') ?? 'unknown',
      messageCount: messages.reduce((sum, m) => sum + m.length, 0),
    });
  }

  // ---------------------------------------------------------------
  // Public API — Audit Log Access
  // ---------------------------------------------------------------

  /**
   * Get the full audit log for this session.
   */
  getAuditLog(): ReadonlyArray<GNSAuditEvent> {
    return this._auditLog;
  }

  /**
   * Get audit log filtered by event type.
   */
  getEventsByType(eventType: string): GNSAuditEvent[] {
    return this._auditLog.filter(e => e.eventType === eventType);
  }

  /**
   * Get count of events by type.
   */
  getEventSummary(): Record<string, number> {
    const summary: Record<string, number> = {};
    for (const event of this._auditLog) {
      summary[event.eventType] = (summary[event.eventType] ?? 0) + 1;
    }
    return summary;
  }

  /**
   * Force flush all buffered breadcrumbs to the backend.
   */
  async flush(): Promise<{ stored: number; violations: number }> {
    return this._identity.flushBreadcrumbs();
  }

  /**
   * Generate a compliance audit report object.
   */
  async generateAuditReport(): Promise<{
    agentPk: string;
    sessionEvents: number;
    eventSummary: Record<string, number>;
    breadcrumbsFlushed: number;
    compliance: unknown;
    timestamp: string;
  }> {
    const compliance = await this._identity.getCompliance(true);
    const flushed = await this.flush();

    return {
      agentPk: this._identity.publicKey,
      sessionEvents: this._auditLog.length,
      eventSummary: this.getEventSummary(),
      breadcrumbsFlushed: flushed.stored,
      compliance,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Copy this handler (required by LangChain BaseCallbackHandler interface).
   */
  copy(): GNSComplianceCallback {
    return new GNSComplianceCallback({
      identity: this._identity,
      autoBreadcrumb: this._autoBreadcrumb,
      flushThreshold: this._flushThreshold,
      verbose: this._verbose,
      h3CellOverride: this._h3Cell,
    });
  }
}
