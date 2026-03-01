import { createGNSDelegationTool, createGNSComplianceGuardrail } from '../src/GNSDelegationTool';
import { GNSAgentSDK } from '@gns-aip/sdk';

describe('GNSDelegationTool', () => {
  let sdk: GNSAgentSDK;
  let tool: ReturnType<typeof createGNSDelegationTool>;
  const agentId = 'agent-test-001';

  beforeEach(() => {
    sdk = new GNSAgentSDK({ backendUrl: 'http://localhost:3000' });
    tool = createGNSDelegationTool({ sdk, agentId });
  });

  it('should have correct tool name', () => {
    expect(tool.name).toBe('gns_check_delegation');
  });

  it('should have a description', () => {
    expect(tool.description).toBeTruthy();
    expect(tool.description.length).toBeGreaterThan(20);
  });

  it('should have parameters schema', () => {
    expect(tool.parameters).toBeDefined();
    expect(tool.parameters.type).toBe('object');
    expect(tool.parameters.properties.action).toBeDefined();
    expect(tool.parameters.properties.territory).toBeDefined();
  });

  it('should return authorized for valid action', async () => {
    const result = await tool.execute({ action: 'search' });
    const parsed = JSON.parse(result);
    expect(parsed.authorized).toBe(true);
    expect(parsed.complianceTier).toBe('VERIFIED');
  });

  it('should return unauthorized for forbidden action', async () => {
    const result = await tool.execute({ action: 'forbidden-action' });
    const parsed = JSON.parse(result);
    expect(parsed.authorized).toBe(false);
  });

  it('should check territory when provided', async () => {
    const result = await tool.execute({ action: 'search', territory: '8a2a1072b59ffff' });
    const parsed = JSON.parse(result);
    expect(parsed.authorized).toBe(true);
    expect(parsed.delegationChain).toBeDefined();
  });

  it('should include compliance tier in result', async () => {
    const result = await tool.execute({});
    const parsed = JSON.parse(result);
    expect(parsed.complianceTier).toBeDefined();
    expect(['SHADOW', 'BASIC', 'VERIFIED', 'TRUSTED', 'SOVEREIGN']).toContain(parsed.complianceTier);
  });

  it('should include human-readable summary', async () => {
    const result = await tool.execute({ action: 'search' });
    const parsed = JSON.parse(result);
    expect(parsed.summary).toBeTruthy();
    expect(typeof parsed.summary).toBe('string');
    expect(parsed.summary).toContain('authorized');
  });

  it('should return valid JSON', async () => {
    const result = await tool.execute({ action: 'search' });
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('should handle errors gracefully', async () => {
    const brokenSdk = {
      getAgentManifest: jest.fn().mockRejectedValue(new Error('network error')),
      getCompliance: jest.fn().mockRejectedValue(new Error('network error')),
    } as any;

    // Mock DelegationChain.verify to throw
    const { DelegationChain } = require('@gns-aip/sdk');
    jest.spyOn(DelegationChain, 'verify').mockRejectedValueOnce(new Error('chain error'));

    const brokenTool = createGNSDelegationTool({ sdk: brokenSdk, agentId });
    const result = await brokenTool.execute({ action: 'search' });
    const parsed = JSON.parse(result);
    expect(parsed.authorized).toBe(false);
    expect(parsed.summary).toContain('error');
  });
});

describe('GNSComplianceGuardrail', () => {
  let sdk: GNSAgentSDK;

  beforeEach(() => {
    sdk = new GNSAgentSDK({ backendUrl: 'http://localhost:3000' });
  });

  it('should have correct name', () => {
    const guardrail = createGNSComplianceGuardrail({
      sdk,
      agentId: 'agent-test-001',
      minimumTier: 'BASIC',
    });
    expect(guardrail.name).toBe('gns_compliance_check');
  });

  it('should pass when tier meets minimum', async () => {
    const guardrail = createGNSComplianceGuardrail({
      sdk,
      agentId: 'agent-test-001',
      minimumTier: 'BASIC',
    });
    const result = await guardrail.execute();
    expect(result.tripwireTriggered).toBe(false);
  });

  it('should pass when tier exceeds minimum', async () => {
    // Mock returns VERIFIED, minimum is BASIC
    const guardrail = createGNSComplianceGuardrail({
      sdk,
      agentId: 'agent-test-001',
      minimumTier: 'BASIC',
    });
    const result = await guardrail.execute();
    expect(result.tripwireTriggered).toBe(false);
  });

  it('should trip when tier is below minimum', async () => {
    // Mock returns VERIFIED (index 2), require SOVEREIGN (index 4)
    const guardrail = createGNSComplianceGuardrail({
      sdk,
      agentId: 'agent-test-001',
      minimumTier: 'SOVEREIGN',
    });
    const result = await guardrail.execute();
    expect(result.tripwireTriggered).toBe(true);
    expect(result.outputInfo?.currentTier).toBe('VERIFIED');
    expect(result.outputInfo?.minimumTier).toBe('SOVEREIGN');
  });

  it('should trip on compliance fetch error', async () => {
    const brokenSdk = {
      getCompliance: jest.fn().mockRejectedValue(new Error('network')),
    } as any;
    const guardrail = createGNSComplianceGuardrail({
      sdk: brokenSdk,
      agentId: 'agent-test-001',
      minimumTier: 'BASIC',
    });
    const result = await guardrail.execute();
    expect(result.tripwireTriggered).toBe(true);
  });
});
