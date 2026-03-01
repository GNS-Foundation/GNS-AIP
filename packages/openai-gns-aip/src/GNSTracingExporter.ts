/**
 * GNSTracingExporter — OpenAI Agents SDK SpanExporter for GNS-AIP compliance.
 *
 * Plugs into the OpenAI Agents SDK's built-in tracing system via
 * `BatchTraceProcessor` + `setTraceProcessors()`. Every trace span
 * (agent turns, tool calls, model invocations, guardrail checks)
 * is converted to a GNS-AIP breadcrumb and submitted to the backend.
 *
 * Usage:
 *   import { BatchTraceProcessor, setTraceProcessors } from '@openai/agents';
 *   import { GNSTracingExporter } from 'openai-gns-aip';
 *
 *   const exporter = new GNSTracingExporter({
 *     backendUrl: 'https://gns-browser-production.up.railway.app',
 *     agentId: 'agent-001',
 *   });
 *
 *   setTraceProcessors([new BatchTraceProcessor(exporter)]);
 *
 * Privacy by design:
 * - Never logs full prompts, completions, or tool inputs/outputs
 * - Only records: span type, timing, token counts, tool names
 * - All content is hashed, not stored
 */

import { GNSAgentSDK } from '@gns-aip/sdk';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GNSTracingExporterOptions {
  /** GNS backend URL */
  backendUrl: string;
  /** Provisioned agent ID */
  agentId: string;
  /** Pre-configured SDK instance (optional — created from backendUrl if not provided) */
  sdk?: GNSAgentSDK;
  /** Default H3 cell for breadcrumb location */
  defaultH3Cell?: string;
  /** Maximum breadcrumbs to batch before forcing a flush */
  batchSize?: number;
  /** Enable verbose console logging for debugging */
  debug?: boolean;
}

export interface GNSTraceSpan {
  traceId: string;
  spanId: string;
  parentId?: string;
  name: string;
  kind: string;
  startTime: number;
  endTime?: number;
  attributes?: Record<string, unknown>;
  status?: { code: number; message?: string };
  spanData?: Record<string, unknown>;
}

export interface GNSTraceBreadcrumb {
  h3Cell: string;
  operationType: string;
  operationHash: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

// ─── Exporter Implementation ─────────────────────────────────────────────────

/**
 * GNSTracingExporter converts OpenAI Agents SDK trace spans into
 * GNS-AIP breadcrumbs for compliance auditing.
 *
 * Implements the SpanExporter interface expected by BatchTraceProcessor:
 * - export(spans): Process a batch of completed spans
 * - shutdown(): Flush remaining spans and clean up
 */
export class GNSTracingExporter {
  private sdk: GNSAgentSDK;
  private agentId: string;
  private defaultH3Cell: string;
  private batchSize: number;
  private debug: boolean;
  private pendingBreadcrumbs: GNSTraceBreadcrumb[] = [];
  private exportedSpanCount = 0;
  private errorCount = 0;
  private _shutdown = false;

  constructor(options: GNSTracingExporterOptions) {
    this.sdk = options.sdk || new GNSAgentSDK({ backendUrl: options.backendUrl });
    this.agentId = options.agentId;
    this.defaultH3Cell = options.defaultH3Cell || '8a2a1072b59ffff';
    this.batchSize = options.batchSize || 100;
    this.debug = options.debug || false;
  }

  // ─── SpanExporter Interface ────────────────────────────────────────────

  /**
   * Export a batch of trace spans.
   * Called by BatchTraceProcessor when spans complete.
   *
   * Converts each span to a privacy-preserving breadcrumb and batches
   * them for submission to the GNS backend.
   */
  async export(spans: GNSTraceSpan[]): Promise<void> {
    if (this._shutdown) return;

    for (const span of spans) {
      const breadcrumb = this.spanToBreadcrumb(span);
      this.pendingBreadcrumbs.push(breadcrumb);
      this.exportedSpanCount++;

      if (this.debug) {
        console.log(`[GNS-AIP Trace] ${span.kind}/${span.name} → breadcrumb`);
      }
    }

    if (this.pendingBreadcrumbs.length >= this.batchSize) {
      await this.flush();
    }
  }

  /**
   * Shutdown the exporter — flush remaining breadcrumbs.
   * Called when the trace processor is stopped.
   */
  async shutdown(): Promise<void> {
    this._shutdown = true;
    await this.flush();

    if (this.debug) {
      console.log(
        `[GNS-AIP Trace] Shutdown: exported=${this.exportedSpanCount}, errors=${this.errorCount}`,
      );
    }
  }

  /**
   * Force flush any pending breadcrumbs.
   * Called by BatchTraceProcessor.forceFlush() or internally.
   */
  async forceFlush(): Promise<void> {
    await this.flush();
  }

  // ─── Span → Breadcrumb Conversion ─────────────────────────────────────

  /**
   * Convert a trace span to a GNS-AIP breadcrumb.
   *
   * Privacy rules:
   * - NEVER include prompts, completions, or tool inputs/outputs
   * - Only include: span type, name, timing, counts, error status
   * - Hash any identifiers for uniqueness without disclosure
   */
  private spanToBreadcrumb(span: GNSTraceSpan): GNSTraceBreadcrumb {
    const metadata = this.extractSafeMetadata(span);
    const operationHash = this.hashSpan(span);

    return {
      h3Cell: this.defaultH3Cell,
      operationType: this.classifySpan(span),
      operationHash,
      timestamp: new Date(span.startTime).toISOString(),
      metadata,
    };
  }

  /**
   * Extract only safe, privacy-preserving metadata from a span.
   */
  private extractSafeMetadata(span: GNSTraceSpan): Record<string, unknown> {
    const safe: Record<string, unknown> = {
      spanKind: span.kind,
      spanName: span.name,
      traceId: span.traceId,
      spanId: span.spanId,
    };

    // Duration in ms
    if (span.startTime && span.endTime) {
      safe.durationMs = span.endTime - span.startTime;
    }

    // Error status (but not error messages which might contain content)
    if (span.status) {
      safe.statusCode = span.status.code;
      safe.hasError = span.status.code !== 0;
    }

    // Safe attributes from spanData
    if (span.spanData) {
      const data = span.spanData;

      // Model info (safe)
      if ('model' in data) safe.model = data.model;
      if ('model_config' in data) {
        const config = data.model_config as Record<string, unknown>;
        safe.temperature = config?.temperature;
        safe.maxTokens = config?.max_tokens;
      }

      // Token counts (safe — just numbers, no content)
      if ('usage' in data) {
        const usage = data.usage as Record<string, unknown>;
        safe.promptTokens = usage?.input_tokens ?? usage?.prompt_tokens;
        safe.completionTokens = usage?.output_tokens ?? usage?.completion_tokens;
        safe.totalTokens = usage?.total_tokens;
      }

      // Tool name (safe — no inputs/outputs)
      if ('tool_name' in data) safe.toolName = data.tool_name;
      if ('tool_type' in data) safe.toolType = data.tool_type;

      // Agent name (safe)
      if ('agent_name' in data) safe.agentName = data.agent_name;

      // Handoff info (safe — just agent names)
      if ('from_agent' in data) safe.fromAgent = data.from_agent;
      if ('to_agent' in data) safe.toAgent = data.to_agent;

      // Guardrail info (safe)
      if ('guardrail_name' in data) safe.guardrailName = data.guardrail_name;
      if ('guardrail_triggered' in data) safe.guardrailTriggered = data.guardrail_triggered;

      // Turn count (safe)
      if ('turn_count' in data) safe.turnCount = data.turn_count;
      if ('max_turns' in data) safe.maxTurns = data.max_turns;
    }

    return safe;
  }

  /**
   * Classify a span into a GNS-AIP operation type.
   */
  private classifySpan(span: GNSTraceSpan): string {
    const kind = (span.kind || '').toLowerCase();
    const name = (span.name || '').toLowerCase();

    if (kind.includes('agent') || name.includes('agent')) return 'oai_agent';
    if (kind.includes('generation') || name.includes('llm') || name.includes('model'))
      return 'oai_generation';
    if (kind.includes('tool') || name.includes('tool')) return 'oai_tool';
    if (kind.includes('handoff') || name.includes('handoff')) return 'oai_handoff';
    if (kind.includes('guardrail') || name.includes('guardrail')) return 'oai_guardrail';
    if (kind.includes('function') || name.includes('function')) return 'oai_function';

    return `oai_${kind || 'span'}`;
  }

  // ─── Flush to Backend ──────────────────────────────────────────────────

  /**
   * Submit all pending breadcrumbs to the GNS backend.
   */
  private async flush(): Promise<void> {
    if (this.pendingBreadcrumbs.length === 0) return;

    const batch = [...this.pendingBreadcrumbs];
    this.pendingBreadcrumbs = [];

    try {
      await this.sdk.submitBreadcrumbs(this.agentId, batch);

      if (this.debug) {
        console.log(`[GNS-AIP Trace] Flushed ${batch.length} breadcrumbs`);
      }
    } catch (error) {
      this.errorCount++;
      // Re-queue failed breadcrumbs (up to batchSize limit to avoid unbounded growth)
      if (this.pendingBreadcrumbs.length + batch.length <= this.batchSize * 2) {
        this.pendingBreadcrumbs.push(...batch);
      }
      console.warn('[GNS-AIP Trace] Flush failed:', error);
    }
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  /**
   * Get exporter statistics.
   */
  getStats(): {
    exportedSpans: number;
    pendingBreadcrumbs: number;
    errors: number;
    isShutdown: boolean;
  } {
    return {
      exportedSpans: this.exportedSpanCount,
      pendingBreadcrumbs: this.pendingBreadcrumbs.length,
      errors: this.errorCount,
      isShutdown: this._shutdown,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private hashSpan(span: GNSTraceSpan): string {
    const payload = `${span.traceId}:${span.spanId}:${span.kind}:${span.name}:${span.startTime}`;
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return `oai-trace-${Math.abs(hash).toString(16).padStart(8, '0')}`;
  }
}
