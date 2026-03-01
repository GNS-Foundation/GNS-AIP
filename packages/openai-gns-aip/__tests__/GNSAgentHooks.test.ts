import { GNSAgentHooks } from '../src/GNSAgentHooks';
import { GNSAgentSDK } from '@gns-aip/sdk';

describe('GNSAgentHooks', () => {
  let hooks: GNSAgentHooks;
  let mockSdk: any;

  beforeEach(() => {
    mockSdk = new GNSAgentSDK({ backendUrl: 'http://localhost:3000' });
    mockSdk.submitBreadcrumbs = jest.fn().mockResolvedValue({ accepted: 1, rejected: 0 });

    hooks = new GNSAgentHooks({
      sdk: mockSdk,
      agentId: 'agent-test-001',
      agentPk: 'ed25519-mock-pk',
      flushThreshold: 5,
    });
  });

  describe('Static provision', () => {
    it('should provision and return hooks instance', async () => {
      const provisioned = await GNSAgentHooks.provision({
        backendUrl: 'http://localhost:3000',
        agentType: 'autonomous',
        agentHandle: 'test-agent',
        homeCells: ['8a2a1072b59ffff'],
      });

      expect(provisioned).toBeInstanceOf(GNSAgentHooks);
      expect(provisioned.id).toBe('agent-test-001');
      expect(provisioned.publicKey).toBe('ed25519-mock-public-key-base64');
    });
  });

  describe('Delegation', () => {
    it('should delegate to a human principal', async () => {
      await hooks.delegate('human-pk-123', {
        scope: { actions: ['search'] },
      });
      expect(hooks.isDelegated).toBe(true);
    });

    it('should throw if not provisioned', async () => {
      const unprovisioned = new GNSAgentHooks({ sdk: mockSdk });
      await expect(unprovisioned.delegate('pk')).rejects.toThrow('not provisioned');
    });
  });

  describe('Lifecycle: onStart', () => {
    it('should record agent_start event', async () => {
      await hooks.onStart({}, { name: 'TestAgent' });
      const log = hooks.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].eventType).toBe('agent_start');
      expect(log[0].metadata.agentName).toBe('TestAgent');
    });
  });

  describe('Lifecycle: onEnd', () => {
    it('should record agent_end event and flush', async () => {
      await hooks.onEnd({}, { name: 'TestAgent' }, 'final output');
      const log = hooks.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].eventType).toBe('agent_end');
      expect(log[0].metadata.hasOutput).toBe(true);
      expect(log[0].metadata.outputLength).toBe(12);
      // Should have flushed
      expect(mockSdk.submitBreadcrumbs).toHaveBeenCalled();
    });
  });

  describe('Lifecycle: onHandoff', () => {
    it('should record handoff between agents', async () => {
      await hooks.onHandoff({}, { name: 'TargetAgent' }, { name: 'SourceAgent' });
      const log = hooks.getAuditLog();
      expect(log[0].eventType).toBe('agent_handoff');
      expect(log[0].metadata.from).toBe('SourceAgent');
      expect(log[0].metadata.to).toBe('TargetAgent');
    });
  });

  describe('Lifecycle: onToolStart', () => {
    it('should record tool start with tool name', async () => {
      await hooks.onToolStart({}, { name: 'Agent' }, { name: 'web_search' });
      const log = hooks.getAuditLog();
      expect(log[0].eventType).toBe('tool_start');
      expect(log[0].metadata.toolName).toBe('web_search');
    });
  });

  describe('Lifecycle: onToolEnd', () => {
    it('should record tool end with result metadata', async () => {
      await hooks.onToolEnd({}, { name: 'Agent' }, { name: 'web_search' }, 'search results here');
      const log = hooks.getAuditLog();
      expect(log[0].eventType).toBe('tool_end');
      expect(log[0].metadata.resultLength).toBe(19);
    });
  });

  describe('Privacy guarantees', () => {
    it('should never log actual output content', async () => {
      const sensitiveOutput = 'My SSN is 123-45-6789';
      await hooks.onEnd({}, { name: 'Agent' }, sensitiveOutput);
      const log = hooks.getAuditLog();
      const serialized = JSON.stringify(log[0]);
      expect(serialized).not.toContain('123-45-6789');
      expect(log[0].metadata.outputLength).toBe(21);
    });

    it('should never log tool input content', async () => {
      await hooks.onToolStart({}, { name: 'Agent' }, { name: 'search', input: 'secret query' });
      const log = hooks.getAuditLog();
      const serialized = JSON.stringify(log[0]);
      expect(serialized).not.toContain('secret query');
    });
  });

  describe('Auto-flush', () => {
    it('should auto-flush when threshold reached', async () => {
      for (let i = 0; i < 6; i++) {
        await hooks.onStart({}, { name: `Agent-${i}` });
      }
      // flushThreshold is 5, so should have flushed once
      expect(mockSdk.submitBreadcrumbs).toHaveBeenCalled();
    });
  });

  describe('Manual flush', () => {
    it('should flush pending breadcrumbs', async () => {
      await hooks.onStart({}, { name: 'Agent' });
      expect(hooks.pendingCount).toBe(1);
      await hooks.flushBreadcrumbs();
      expect(hooks.pendingCount).toBe(0);
      expect(mockSdk.submitBreadcrumbs).toHaveBeenCalledWith('agent-test-001', expect.any(Array));
    });

    it('should return null when no agent ID', async () => {
      const noId = new GNSAgentHooks({ sdk: mockSdk });
      const result = await noId.flushBreadcrumbs();
      expect(result).toBeNull();
    });
  });

  describe('Audit log', () => {
    it('should filter by event type', async () => {
      await hooks.onStart({}, { name: 'A' });
      await hooks.onToolStart({}, { name: 'A' }, { name: 'tool1' });
      await hooks.onEnd({}, { name: 'A' }, 'done');

      const toolEvents = hooks.getAuditLog({ eventTypes: ['tool_start'] });
      expect(toolEvents).toHaveLength(1);
    });

    it('should filter by timestamp', async () => {
      const before = new Date().toISOString();
      await hooks.onStart({}, { name: 'A' });

      const events = hooks.getAuditLog({ since: before });
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Audit report', () => {
    it('should generate a compliance report', async () => {
      await hooks.onStart({}, { name: 'A' });
      await hooks.onToolStart({}, { name: 'A' }, { name: 'search' });
      await hooks.onToolEnd({}, { name: 'A' }, { name: 'search' }, 'result');
      await hooks.onEnd({}, { name: 'A' }, 'output');

      const report = hooks.generateAuditReport();
      expect(report.agentId).toBe('agent-test-001');
      expect(report.totalEvents).toBe(4);
      expect(report.eventSummary.agent_start).toBe(1);
      expect(report.eventSummary.tool_start).toBe(1);
      expect(report.eventSummary.tool_end).toBe(1);
      expect(report.eventSummary.agent_end).toBe(1);
    });
  });

  describe('Compliance queries', () => {
    it('should get compliance score', async () => {
      const compliance = await hooks.getCompliance();
      expect(compliance).toBeDefined();
    });

    it('should get agent manifest', async () => {
      const manifest = await hooks.getManifest();
      expect(manifest).toBeDefined();
    });

    it('should verify delegation chain', async () => {
      const result = await hooks.verifyDelegation();
      expect(result).toBeDefined();
    });

    it('should check specific action authorization', async () => {
      const result = await hooks.checkAction('search');
      expect(result.authorized).toBe(true);
    });

    it('should deny forbidden action', async () => {
      const result = await hooks.checkAction('forbidden-action');
      expect(result.authorized).toBe(false);
    });
  });
});
