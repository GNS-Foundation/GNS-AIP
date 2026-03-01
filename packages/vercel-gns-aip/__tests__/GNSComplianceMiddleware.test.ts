import { createGNSComplianceMiddleware } from '../src/GNSComplianceMiddleware';
import { GNSAgentSDK } from '@gns-aip/sdk';

describe('GNSComplianceMiddleware', () => {
  let sdk: any;

  beforeEach(() => {
    sdk = new GNSAgentSDK({ backendUrl: 'http://localhost:3000' });
    sdk.submitBreadcrumbs = jest.fn().mockResolvedValue({ accepted: 1, rejected: 0 });
    sdk.getCompliance = jest.fn().mockResolvedValue({ tier: 'VERIFIED', total: 85 });
  });

  describe('Creation', () => {
    it('should create middleware with required options', () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      expect(mw).toBeDefined();
      expect(mw.transformParams).toBeInstanceOf(Function);
      expect(mw.wrapGenerate).toBeInstanceOf(Function);
      expect(mw.wrapStream).toBeInstanceOf(Function);
    });

    it('should expose GNS-AIP extension methods', () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      expect(mw.flush).toBeInstanceOf(Function);
      expect(mw.getStats).toBeInstanceOf(Function);
      expect(mw.getAgentId).toBeInstanceOf(Function);
      expect(mw.verifyDelegation).toBeInstanceOf(Function);
      expect(mw.checkAction).toBeInstanceOf(Function);
      expect(mw.getCompliance).toBeInstanceOf(Function);
    });

    it('should return correct agent ID', () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      expect(mw.getAgentId()).toBe('agent-001');
    });
  });

  describe('transformParams', () => {
    it('should pass through params unchanged', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      const params = { prompt: [{ role: 'user', content: 'hello' }], maxTokens: 100 };
      const result = await mw.transformParams({ type: 'generate', params });
      expect(result).toBe(params);
    });

    it('should record a breadcrumb on transformParams', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001', autoFlush: false });
      await mw.transformParams({ type: 'generate', params: { maxTokens: 100 } });
      const stats = mw.getStats();
      expect(stats.pendingBreadcrumbs).toBe(1);
    });

    it('should extract safe params (never content)', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001', autoFlush: false });
      const params = {
        prompt: [{ role: 'user', content: 'My SSN is 123-45-6789' }],
        maxTokens: 200,
        temperature: 0.7,
      };
      await mw.transformParams({ type: 'generate', params });
      // Flush and check breadcrumbs
      await mw.flush();
      const call = sdk.submitBreadcrumbs.mock.calls[0];
      const breadcrumb = call[1][0];
      const serialized = JSON.stringify(breadcrumb);
      expect(serialized).not.toContain('123-45-6789');
      expect(breadcrumb.metadata.maxTokens).toBe(200);
      expect(breadcrumb.metadata.temperature).toBe(0.7);
      expect(breadcrumb.metadata.messageCount).toBe(1);
    });
  });

  describe('Tier guardrail', () => {
    it('should block calls when tier is below minimum', async () => {
      sdk.getCompliance.mockResolvedValue({ tier: 'SHADOW', total: 10 });
      const mw = createGNSComplianceMiddleware({
        sdk,
        agentId: 'agent-001',
        minimumTier: 'VERIFIED',
      });
      await expect(mw.transformParams({ type: 'generate', params: {} })).rejects.toThrow(
        'GNS-AIP: Agent compliance tier SHADOW is below minimum VERIFIED',
      );
    });

    it('should allow calls when tier meets minimum', async () => {
      sdk.getCompliance.mockResolvedValue({ tier: 'VERIFIED', total: 85 });
      const mw = createGNSComplianceMiddleware({
        sdk,
        agentId: 'agent-001',
        minimumTier: 'BASIC',
      });
      const result = await mw.transformParams({ type: 'generate', params: {} });
      expect(result).toEqual({});
    });

    it('should not check tier when no minimumTier set', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      await mw.transformParams({ type: 'generate', params: {} });
      expect(sdk.getCompliance).not.toHaveBeenCalled();
    });
  });

  describe('wrapGenerate', () => {
    it('should track generate calls', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      const mockResult = { usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, finishReason: 'stop' };
      const doGenerate = jest.fn().mockResolvedValue(mockResult);

      const result = await mw.wrapGenerate({ doGenerate, params: {}, model: {} });
      expect(result).toBe(mockResult);
      expect(doGenerate).toHaveBeenCalled();

      const stats = mw.getStats();
      expect(stats.totalCalls).toBe(1);
      expect(stats.generateCalls).toBe(1);
      expect(stats.totalTokens).toBe(15);
    });

    it('should auto-flush after generate', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001', autoFlush: true });
      const doGenerate = jest.fn().mockResolvedValue({ usage: {} });
      await mw.wrapGenerate({ doGenerate, params: {}, model: {} });
      expect(sdk.submitBreadcrumbs).toHaveBeenCalled();
    });

    it('should track errors without throwing content', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      const doGenerate = jest.fn().mockRejectedValue(new Error('Model failed'));

      await expect(mw.wrapGenerate({ doGenerate, params: {}, model: {} })).rejects.toThrow('Model failed');
      const stats = mw.getStats();
      expect(stats.errors).toBe(1);
    });

    it('should never include content in breadcrumbs', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      const mockResult = {
        text: 'This is sensitive output about user data',
        usage: { totalTokens: 50 },
        toolCalls: [{ toolName: 'search', args: { query: 'secret search' } }],
      };
      const doGenerate = jest.fn().mockResolvedValue(mockResult);
      await mw.wrapGenerate({ doGenerate, params: {}, model: {} });

      const call = sdk.submitBreadcrumbs.mock.calls[0];
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain('sensitive output');
      expect(serialized).not.toContain('secret search');
      // Should include tool name though
      expect(serialized).toContain('search');
    });
  });

  describe('wrapStream', () => {
    it('should track stream calls', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001', autoFlush: false });
      const doStream = jest.fn().mockResolvedValue({ stream: 'mock' });

      const result = await mw.wrapStream({ doStream, params: {}, model: {} });
      expect(result).toEqual({ stream: 'mock' });

      const stats = mw.getStats();
      expect(stats.totalCalls).toBe(1);
      expect(stats.streamCalls).toBe(1);
    });

    it('should track stream errors', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      const doStream = jest.fn().mockRejectedValue(new Error('Stream failed'));

      await expect(mw.wrapStream({ doStream, params: {}, model: {} })).rejects.toThrow('Stream failed');
      expect(mw.getStats().errors).toBe(1);
    });
  });

  describe('flush', () => {
    it('should submit pending breadcrumbs', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001', autoFlush: false });
      await mw.transformParams({ type: 'generate', params: {} });
      await mw.flush();
      expect(sdk.submitBreadcrumbs).toHaveBeenCalledWith('agent-001', expect.any(Array));
    });

    it('should return null when no pending breadcrumbs', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      const result = await mw.flush();
      expect(result).toBeNull();
    });

    it('should handle flush errors gracefully', async () => {
      sdk.submitBreadcrumbs.mockRejectedValueOnce(new Error('Network error'));
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001', autoFlush: false });
      await mw.transformParams({ type: 'generate', params: {} });
      await mw.flush();
      // Should re-queue breadcrumbs
      expect(mw.getStats().pendingBreadcrumbs).toBe(1);
    });
  });

  describe('Compliance queries', () => {
    it('should get compliance', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      const result = await mw.getCompliance();
      expect(result).toBeDefined();
    });

    it('should verify delegation', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      const result = await mw.verifyDelegation();
      expect(result).toBeDefined();
    });

    it('should check action', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      const result = await mw.checkAction('search');
      expect(result.authorized).toBe(true);
    });
  });

  describe('Stats', () => {
    it('should track cumulative stats', async () => {
      const mw = createGNSComplianceMiddleware({ sdk, agentId: 'agent-001' });
      const doGenerate = jest.fn().mockResolvedValue({ usage: { totalTokens: 100 } });

      await mw.wrapGenerate({ doGenerate, params: {}, model: {} });
      await mw.wrapGenerate({ doGenerate, params: {}, model: {} });

      const stats = mw.getStats();
      expect(stats.totalCalls).toBe(2);
      expect(stats.generateCalls).toBe(2);
      expect(stats.totalTokens).toBe(200);
      expect(stats.lastCallTimestamp).toBeTruthy();
    });
  });
});
