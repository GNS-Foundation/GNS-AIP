import { createGNSDelegationTool } from '../src/GNSDelegationTool';

jest.mock('@gns-aip/sdk', () => require('../__mocks__/@gns-aip/sdk'));

import { GNSAgentSDK, DelegationChain } from '@gns-aip/sdk';

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

  it('should return authorized for valid action', async () => {
    const result = await tool.invoke({ action: 'search' });
    const parsed = JSON.parse(result);
    expect(parsed.authorized).toBe(true);
    expect(parsed.complianceTier).toBe('VERIFIED');
  });

  it('should return unauthorized for forbidden action', async () => {
    const result = await tool.invoke({ action: 'forbidden-action' });
    const parsed = JSON.parse(result);
    expect(parsed.authorized).toBe(false);
  });

  it('should check territory when provided', async () => {
    const result = await tool.invoke({ action: 'search', territory: '8a2a1072b59ffff' });
    const parsed = JSON.parse(result);
    expect(parsed.authorized).toBe(true);
    expect(parsed.delegationChain).toBeDefined();
  });

  it('should include compliance tier in result', async () => {
    const result = await tool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.complianceTier).toBeDefined();
    expect(['SHADOW', 'BASIC', 'VERIFIED', 'TRUSTED', 'SOVEREIGN']).toContain(parsed.complianceTier);
  });

  it('should include a human-readable summary', async () => {
    const result = await tool.invoke({ action: 'search' });
    const parsed = JSON.parse(result);
    expect(parsed.summary).toBeTruthy();
    expect(typeof parsed.summary).toBe('string');
  });

  it('should handle errors gracefully', async () => {
    const brokenSdk = { getAgentManifest: jest.fn().mockRejectedValue(new Error('network error')), getCompliance: jest.fn().mockRejectedValue(new Error('network error')) } as any;
    jest.spyOn(DelegationChain, 'checkScope').mockRejectedValueOnce(new Error('network error'));
    const brokenTool = createGNSDelegationTool({ sdk: brokenSdk, agentId });
    const result = await brokenTool.invoke({ action: 'search' });
    const parsed = JSON.parse(result);
    expect(parsed.authorized).toBe(false);
    expect(parsed.summary).toContain('error');
  });

  it('should return valid JSON', async () => {
    const result = await tool.invoke({ action: 'search' });
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
