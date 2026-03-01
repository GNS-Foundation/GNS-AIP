import { GNSComplianceCallback } from '../src/GNSComplianceCallback';

// Mock the SDK
jest.mock('@gns-aip/sdk', () => require('../__mocks__/@gns-aip/sdk'));

describe('GNSComplianceCallback', () => {
  let callback: GNSComplianceCallback;
  const mockAgentId = 'agent-test-001';
  const mockSdk = { submitBreadcrumbs: jest.fn().mockResolvedValue({ accepted: 1, rejected: 0 }) } as any;

  beforeEach(() => {
    callback = new GNSComplianceCallback({ agentId: mockAgentId, sdk: mockSdk, flushThreshold: 5 });
  });

  describe('LLM events', () => {
    it('should record LLM start event', async () => {
      await callback.handleLLMStart({ id: ['test'] }, ['test prompt'], 'run-1');
      const log = callback.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].eventType).toBe('llm_start');
    });

    it('should record LLM end event', async () => {
      await callback.handleLLMEnd({ generations: [[{ text: 'response' }]] }, 'run-1');
      const log = callback.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].eventType).toBe('llm_end');
    });

    it('should record LLM error event', async () => {
      await callback.handleLLMError(new Error('test error'), 'run-1');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('llm_error');
    });
  });

  describe('Chain events', () => {
    it('should record chain start', async () => {
      await callback.handleChainStart({ id: ['chain'] }, { input: 'test' }, 'run-2');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('chain_start');
    });

    it('should record chain end', async () => {
      await callback.handleChainEnd({ output: 'result' }, 'run-2');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('chain_end');
    });

    it('should record chain error', async () => {
      await callback.handleChainError(new Error('chain fail'), 'run-2');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('chain_error');
    });
  });

  describe('Tool events', () => {
    it('should record tool start', async () => {
      await callback.handleToolStart({ id: ['tool'], name: 'search' }, 'query', 'run-3');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('tool_start');
      expect(log[0].metadata.toolName).toBe('search');
    });

    it('should record tool end', async () => {
      await callback.handleToolEnd('tool output', 'run-3');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('tool_end');
    });

    it('should record tool error', async () => {
      await callback.handleToolError(new Error('tool fail'), 'run-3');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('tool_error');
    });
  });

  describe('Agent events', () => {
    it('should record agent action', async () => {
      await callback.handleAgentAction({ tool: 'search', toolInput: 'query', log: '' }, 'run-4');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('agent_action');
    });

    it('should record agent end', async () => {
      await callback.handleAgentEnd({ returnValues: { output: 'done' }, log: '' }, 'run-4');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('agent_end');
    });
  });

  describe('Retriever events', () => {
    it('should record retriever start', async () => {
      await callback.handleRetrieverStart({ id: ['ret'] }, 'search query', 'run-5');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('retriever_start');
    });

    it('should record retriever end', async () => {
      await callback.handleRetrieverEnd([{ pageContent: 'doc', metadata: {} }], 'run-5');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('retriever_end');
    });

    it('should record retriever error', async () => {
      await callback.handleRetrieverError(new Error('ret fail'), 'run-5');
      const log = callback.getAuditLog();
      expect(log[0].eventType).toBe('retriever_error');
    });
  });

  describe('Privacy guarantees', () => {
    it('should never log full prompt text', async () => {
      const sensitivePrompt = 'My SSN is 123-45-6789 and my password is secret123';
      await callback.handleLLMStart({ id: ['test'] }, [sensitivePrompt], 'run-priv');
      const log = callback.getAuditLog();
      const serialized = JSON.stringify(log[0]);
      expect(serialized).not.toContain('123-45-6789');
      expect(serialized).not.toContain('secret123');
    });

    it('should only log metadata lengths and counts', async () => {
      await callback.handleLLMStart({ id: ['test'] }, ['prompt one', 'prompt two'], 'run-meta');
      const log = callback.getAuditLog();
      expect(log[0].metadata.promptCount).toBe(2);
      expect(log[0].metadata.totalPromptLength).toBeDefined();
    });
  });

  describe('Breadcrumb creation', () => {
    it('should create breadcrumbs for events', async () => {
      await callback.handleLLMStart({ id: ['test'] }, ['prompt'], 'run-bc');
      const breadcrumbs = (callback as any).pendingBreadcrumbs;
      expect(breadcrumbs.length).toBeGreaterThanOrEqual(1);
    });

    it('should auto-flush when threshold reached', async () => {
      for (let i = 0; i < 6; i++) {
        await callback.handleLLMStart({ id: ['test'] }, ['prompt'], `run-flush-${i}`);
      }
      expect(mockSdk.submitBreadcrumbs).toHaveBeenCalled();
    });
  });

  describe('Audit log filtering', () => {
    it('should filter by event type', async () => {
      await callback.handleLLMStart({ id: ['t'] }, ['p'], 'r1');
      await callback.handleToolStart({ id: ['t'], name: 'x' }, 'i', 'r2');
      await callback.handleLLMEnd({ generations: [[{ text: 'r' }]] }, 'r3');
      const llmEvents = callback.getAuditLog({ eventTypes: ['llm_start', 'llm_end'] });
      expect(llmEvents).toHaveLength(2);
    });
  });

  describe('Audit report', () => {
    it('should generate a compliance report', async () => {
      await callback.handleLLMStart({ id: ['t'] }, ['p'], 'r1');
      await callback.handleLLMEnd({ generations: [[{ text: 'r' }]] }, 'r1');
      await callback.handleToolStart({ id: ['t'], name: 'search' }, 'q', 'r2');
      const report = callback.generateAuditReport();
      expect(report.agentId).toBe(mockAgentId);
      expect(report.totalEvents).toBe(3);
      expect(report.eventSummary).toBeDefined();
    });
  });
});
