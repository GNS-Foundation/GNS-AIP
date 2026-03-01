# @gns-aip/sdk

**AI Agent Identity Protocol for the Geospatial Naming System.**

Give your AI agents cryptographic identity, territorial jurisdiction, human delegation chains, and compliance scoring.

## Install

```bash
npm install @gns-aip/sdk
```

Requires Node.js >= 18.

## Quick Start

```typescript
import { generateAgentIdentity, createDelegationCert, createVirtualBreadcrumb } from '@gns-aip/sdk';

// 1. Provision: agent gets Ed25519 identity (= Stellar wallet = GNS ID)
const agent = generateAgentIdentity();

// 2. Delegate: human authorizes agent with territorial + facet constraints
const cert = await createDelegationCert({
  deployerIdentity: deployer.publicKey,
  principalIdentity: human.publicKey,
  agentIdentity: agent.publicKey,
  territoryCells: jurisdiction.cells,
  facetPermissions: ['health'],
}, human.secretKey);

// 3. Operate: agent records auditable Proof-of-Jurisdiction breadcrumbs
const breadcrumb = await createVirtualBreadcrumb({
  agentIdentity: agent.publicKey,
  operationCell: jurisdiction.cells[0],
  meta: { operationType: 'inference', delegationCertHash: cert.certHash, facet: 'health', withinTerritory: true },
}, agent.secretKey, null);
```

## Modules

| Module | Description |
|--------|-------------|
| crypto | Ed25519 keypairs, signing, Stellar addresses |
| h3 | H3 territorial binding, jurisdiction builders |
| delegation | Delegation certificates, Cloudflare headers |
| delegation-chain | Sub-delegation chain verification (multi-agent) |
| breadcrumb | Virtual breadcrumbs (Proof-of-Jurisdiction) |
| compliance | TierGate compliance scoring (5 tiers) |
| manifest | Agent public identity documents |
| escalation | Human-in-the-Loop (anti-delegation-drift) |
| mcp | MCP middleware for server-side compliance gating |

## License

Apache-2.0 — GNS Foundation
