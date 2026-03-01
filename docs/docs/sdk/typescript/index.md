# TypeScript SDK

`@gns-aip/sdk` is the core TypeScript SDK for GNS-AIP. All TypeScript framework integrations build on this package.

## Install

```bash
npm install @gns-aip/sdk
```

## Features

- **GNSAgentSDK** — HTTP client for all backend endpoints
- **DelegationChain** — Walk and verify delegation chains
- **EscalationPolicy** — Evaluate when to escalate to human oversight
- **ComplianceTier** — 5-tier enum with comparison operators
- **Full TypeScript types** — AgentManifest, DelegationCert, Breadcrumb, ComplianceScore

## Quick Example

```typescript
import { GNSAgentSDK, DelegationChain } from '@gns-aip/sdk';

const sdk = new GNSAgentSDK({
  backendUrl: 'https://gns-browser-production.up.railway.app',
});

const agent = await sdk.provisionAgent({
  agentType: 'autonomous',
  agentHandle: 'research-bot',
  homeCells: ['8a2a1072b59ffff'],
});

await sdk.delegateToAgent({
  principalPk: 'ed25519-human-pk',
  agentId: agent.agentId,
  scope: { actions: ['search', 'code'], resources: ['*'] },
});

const chain = await DelegationChain.verify(sdk, agent.agentId);
const score = await sdk.getCompliance(agent.agentId);
```

## Test Coverage

128 tests across client, types, delegation chain, and escalation policy modules.
