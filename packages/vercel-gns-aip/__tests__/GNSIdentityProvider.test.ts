import { GNSIdentityProvider } from '../src/GNSIdentityProvider';

describe('GNSIdentityProvider', () => {
  describe('create', () => {
    it('should provision agent and return provider', async () => {
      const gns = await GNSIdentityProvider.create({
        backendUrl: 'http://localhost:3000',
        agentType: 'autonomous',
        agentHandle: 'test-agent',
        homeCells: ['8a2a1072b59ffff'],
      });

      expect(gns).toBeInstanceOf(GNSIdentityProvider);
      expect(gns.agentId).toBe('agent-test-001');
      expect(gns.publicKey).toBe('ed25519-mock-public-key-base64');
    });

    it('should create middleware on the provider', async () => {
      const gns = await GNSIdentityProvider.create({
        backendUrl: 'http://localhost:3000',
        agentType: 'autonomous',
      });

      expect(gns.middleware).toBeDefined();
      expect(gns.middleware.transformParams).toBeInstanceOf(Function);
      expect(gns.middleware.wrapGenerate).toBeInstanceOf(Function);
      expect(gns.middleware.wrapStream).toBeInstanceOf(Function);
    });

    it('should create delegation tool on the provider', async () => {
      const gns = await GNSIdentityProvider.create({
        backendUrl: 'http://localhost:3000',
        agentType: 'autonomous',
      });

      expect(gns.delegationTool).toBeDefined();
      expect(gns.delegationTool.description).toBeTruthy();
      expect(gns.delegationTool.execute).toBeInstanceOf(Function);
    });
  });

  describe('delegate', () => {
    it('should delegate to human principal', async () => {
      const gns = await GNSIdentityProvider.create({
        backendUrl: 'http://localhost:3000',
        agentType: 'autonomous',
      });

      expect(gns.isDelegated).toBe(false);
      await gns.delegate('human-pk-123', { scope: { actions: ['search'] } });
      expect(gns.isDelegated).toBe(true);
    });
  });

  describe('Queries', () => {
    let gns: GNSIdentityProvider;

    beforeEach(async () => {
      gns = await GNSIdentityProvider.create({
        backendUrl: 'http://localhost:3000',
        agentType: 'autonomous',
      });
    });

    it('should get compliance', async () => {
      const result = await gns.getCompliance();
      expect(result).toBeDefined();
    });

    it('should get manifest', async () => {
      const result = await gns.getManifest();
      expect(result).toBeDefined();
    });

    it('should verify delegation', async () => {
      const result = await gns.verifyDelegation();
      expect(result).toBeDefined();
    });

    it('should check action', async () => {
      const result = await gns.checkAction('search');
      expect(result.authorized).toBe(true);
    });

    it('should check forbidden action', async () => {
      const result = await gns.checkAction('forbidden-action');
      expect(result.authorized).toBe(false);
    });
  });

  describe('Stats and flush', () => {
    it('should return stats from middleware', async () => {
      const gns = await GNSIdentityProvider.create({
        backendUrl: 'http://localhost:3000',
        agentType: 'autonomous',
      });

      const stats = gns.getStats();
      expect(stats.totalCalls).toBe(0);
      expect(stats.errors).toBe(0);
    });

    it('should flush middleware breadcrumbs', async () => {
      const gns = await GNSIdentityProvider.create({
        backendUrl: 'http://localhost:3000',
        agentType: 'autonomous',
      });

      const result = await gns.flush();
      expect(result).toBeNull(); // No pending breadcrumbs
    });
  });

  describe('Integration: middleware + tool together', () => {
    it('should work as a complete package', async () => {
      const gns = await GNSIdentityProvider.create({
        backendUrl: 'http://localhost:3000',
        agentType: 'autonomous',
        agentHandle: 'my-nextjs-agent',
        homeCells: ['8a2a1072b59ffff'],
      });

      // Delegate
      await gns.delegate('human-pk');

      // Middleware works
      const params = await gns.middleware.transformParams({
        type: 'generate',
        params: { maxTokens: 100 },
      });
      expect(params).toBeDefined();

      // Tool works
      const delegation = await gns.delegationTool.execute({ action: 'search' });
      expect(delegation.authorized).toBe(true);

      // Stats tracked
      const stats = gns.getStats();
      expect(stats.pendingBreadcrumbs).toBeGreaterThanOrEqual(0);
    });
  });
});
