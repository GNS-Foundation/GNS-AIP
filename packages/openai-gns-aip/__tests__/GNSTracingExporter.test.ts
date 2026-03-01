import { GNSTracingExporter, GNSTraceSpan } from '../src/GNSTracingExporter';
import { GNSAgentSDK } from '@gns-aip/sdk';

describe('GNSTracingExporter', () => {
  let exporter: GNSTracingExporter;
  let mockSdk: any;

  const makeSpan = (overrides: Partial<GNSTraceSpan> = {}): GNSTraceSpan => ({
    traceId: 'trace-001',
    spanId: 'span-001',
    name: 'test-span',
    kind: 'agent',
    startTime: Date.now() - 1000,
    endTime: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    mockSdk = new GNSAgentSDK({ backendUrl: 'http://localhost:3000' });
    mockSdk.submitBreadcrumbs = jest.fn().mockResolvedValue({ accepted: 1, rejected: 0 });

    exporter = new GNSTracingExporter({
      backendUrl: 'http://localhost:3000',
      agentId: 'agent-test-001',
      sdk: mockSdk,
      batchSize: 5,
    });
  });

  describe('export', () => {
    it('should convert spans to pending breadcrumbs', async () => {
      await exporter.export([makeSpan()]);
      const stats = exporter.getStats();
      expect(stats.exportedSpans).toBe(1);
      expect(stats.pendingBreadcrumbs).toBe(1);
    });

    it('should auto-flush when batch size reached', async () => {
      const spans = Array.from({ length: 6 }, (_, i) =>
        makeSpan({ spanId: `span-${i}`, name: `span-${i}` }),
      );
      await exporter.export(spans);
      expect(mockSdk.submitBreadcrumbs).toHaveBeenCalled();
    });

    it('should not export after shutdown', async () => {
      await exporter.shutdown();
      await exporter.export([makeSpan()]);
      const stats = exporter.getStats();
      expect(stats.exportedSpans).toBe(0);
    });
  });

  describe('Span classification', () => {
    it('should classify agent spans', async () => {
      await exporter.export([makeSpan({ kind: 'agent', name: 'my-agent' })]);
      await exporter.forceFlush();
      const call = mockSdk.submitBreadcrumbs.mock.calls[0];
      expect(call[1][0].operationType).toBe('oai_agent');
    });

    it('should classify tool spans', async () => {
      await exporter.export([makeSpan({ kind: 'tool', name: 'web_search' })]);
      await exporter.forceFlush();
      const call = mockSdk.submitBreadcrumbs.mock.calls[0];
      expect(call[1][0].operationType).toBe('oai_tool');
    });

    it('should classify generation spans', async () => {
      await exporter.export([makeSpan({ kind: 'generation', name: 'gpt-4o' })]);
      await exporter.forceFlush();
      const call = mockSdk.submitBreadcrumbs.mock.calls[0];
      expect(call[1][0].operationType).toBe('oai_generation');
    });

    it('should classify handoff spans', async () => {
      await exporter.export([makeSpan({ kind: 'handoff', name: 'transfer' })]);
      await exporter.forceFlush();
      const call = mockSdk.submitBreadcrumbs.mock.calls[0];
      expect(call[1][0].operationType).toBe('oai_handoff');
    });

    it('should classify guardrail spans', async () => {
      await exporter.export([makeSpan({ kind: 'guardrail', name: 'content-filter' })]);
      await exporter.forceFlush();
      const call = mockSdk.submitBreadcrumbs.mock.calls[0];
      expect(call[1][0].operationType).toBe('oai_guardrail');
    });
  });

  describe('Privacy: safe metadata extraction', () => {
    it('should include timing metadata', async () => {
      const start = Date.now() - 500;
      const end = Date.now();
      await exporter.export([makeSpan({ startTime: start, endTime: end })]);
      await exporter.forceFlush();
      const breadcrumb = mockSdk.submitBreadcrumbs.mock.calls[0][1][0];
      expect(breadcrumb.metadata.durationMs).toBeCloseTo(500, -2);
    });

    it('should include model info from spanData', async () => {
      await exporter.export([
        makeSpan({ spanData: { model: 'gpt-4o', agent_name: 'MyAgent' } }),
      ]);
      await exporter.forceFlush();
      const breadcrumb = mockSdk.submitBreadcrumbs.mock.calls[0][1][0];
      expect(breadcrumb.metadata.model).toBe('gpt-4o');
      expect(breadcrumb.metadata.agentName).toBe('MyAgent');
    });

    it('should include token usage from spanData', async () => {
      await exporter.export([
        makeSpan({
          spanData: { usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } },
        }),
      ]);
      await exporter.forceFlush();
      const breadcrumb = mockSdk.submitBreadcrumbs.mock.calls[0][1][0];
      expect(breadcrumb.metadata.promptTokens).toBe(100);
      expect(breadcrumb.metadata.completionTokens).toBe(50);
      expect(breadcrumb.metadata.totalTokens).toBe(150);
    });

    it('should include error status without messages', async () => {
      await exporter.export([
        makeSpan({ status: { code: 2, message: 'Sensitive error details about user data' } }),
      ]);
      await exporter.forceFlush();
      const breadcrumb = mockSdk.submitBreadcrumbs.mock.calls[0][1][0];
      expect(breadcrumb.metadata.statusCode).toBe(2);
      expect(breadcrumb.metadata.hasError).toBe(true);
      // Should NOT include the error message
      const serialized = JSON.stringify(breadcrumb);
      expect(serialized).not.toContain('Sensitive error details');
    });

    it('should never include prompt or completion content', async () => {
      await exporter.export([
        makeSpan({
          spanData: {
            prompt: 'My secret SSN is 123-45-6789',
            completion: 'Here is the sensitive data...',
            input: 'another secret',
            output: 'more secrets',
          },
        }),
      ]);
      await exporter.forceFlush();
      const serialized = JSON.stringify(mockSdk.submitBreadcrumbs.mock.calls[0][1][0]);
      expect(serialized).not.toContain('123-45-6789');
      expect(serialized).not.toContain('sensitive data');
      expect(serialized).not.toContain('another secret');
      expect(serialized).not.toContain('more secrets');
    });
  });

  describe('shutdown', () => {
    it('should flush remaining breadcrumbs on shutdown', async () => {
      await exporter.export([makeSpan(), makeSpan({ spanId: 'span-2' })]);
      await exporter.shutdown();
      expect(mockSdk.submitBreadcrumbs).toHaveBeenCalled();
      expect(exporter.getStats().isShutdown).toBe(true);
    });
  });

  describe('forceFlush', () => {
    it('should submit all pending breadcrumbs', async () => {
      await exporter.export([makeSpan()]);
      await exporter.forceFlush();
      expect(mockSdk.submitBreadcrumbs).toHaveBeenCalledWith('agent-test-001', expect.any(Array));
      expect(exporter.getStats().pendingBreadcrumbs).toBe(0);
    });
  });

  describe('Error handling', () => {
    it('should handle flush errors gracefully', async () => {
      mockSdk.submitBreadcrumbs.mockRejectedValueOnce(new Error('Network error'));
      await exporter.export([makeSpan()]);
      await exporter.forceFlush();
      const stats = exporter.getStats();
      expect(stats.errors).toBe(1);
      // Breadcrumbs should be re-queued
      expect(stats.pendingBreadcrumbs).toBe(1);
    });
  });
});
