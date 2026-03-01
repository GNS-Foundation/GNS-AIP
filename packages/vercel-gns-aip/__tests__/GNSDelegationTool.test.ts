import { createGNSDelegationTool } from '../src/GNSDelegationTool';
import { GNSAgentSDK } from '@gns-aip/sdk';

describe('GNSDelegationTool', () => {
  let sdk: GNSAgentSDK;
  let tool: ReturnType<typeof createGNSDelegationTool>;

  beforeEach(() => {
    sdk = new GNSAgentSDK({ backendUrl: 'http://localhost:3000' });
    tool = createGNSDelegationTool({ sdk, agentId: 'agent-001' });
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
    expect(result.authorized).toBe(true);
    expect(result.complianceTier).toBe('VERIFIED');
    expect(result.summary).toContain('authorized');
  });

  it('should return unauthorized for forbidden action', async () => {
    const result = await tool.execute({ action: 'forbidden-action' });
    expect(result.authorized).toBe(false);
    expect(result.summary).toContain('NOT authorized');
  });

  it('should check territory when provided', async () => {
    const result = await tool.execute({ action: 'search', territory: '8a2a1072b59ffff' });
    expect(result.authorized).toBe(true);
    expect(result.delegationChain).toBeDefined();
    expect(result.delegationChain!.valid).toBe(true);
  });

  it('should include delegation chain info', async () => {
    const result = await tool.execute({});
    expect(result.delegationChain).toBeDefined();
    expect(result.delegationChain!.depth).toBe(1);
    expect(result.delegationChain!.humanRoot).toBe('human-principal-pk');
  });

  it('should include scope when available', async () => {
    const result = await tool.execute({});
    expect(result.scope).toBeDefined();
    expect(result.scope!.actions).toContain('*');
  });

  it('should handle errors gracefully', async () => {
    const { DelegationChain } = require('@gns-aip/sdk');
    jest.spyOn(DelegationChain, 'verify').mockRejectedValueOnce(new Error('network'));
    const result = await tool.execute({ action: 'search' });
    expect(result.authorized).toBe(false);
    expect(result.summary).toContain('error');
  });
});
