# @gns-aip/langchain

> GNS-AIP integration for LangChain — cryptographic identity, delegation certs, and EU AI Act HITL compliance for LangChain agents.

## What it does

Wraps any LangChain agent with the full GNS-AIP compliance stack:

| Without GNS-AIP | With GNS-AIP |
|---|---|
| Anonymous agent | Ed25519 identity (= Stellar wallet address) |
| No authorization | Human-signed delegation cert with H3 territorial scope |
| No oversight | HITL re-authorization gates (EU AI Act Art 14) |
| No audit trail | Signed breadcrumb chain per operation |
| No compliance | TierGate score + EU AI Act compliance report |

## Install

```bash
npm install @gns-aip/langchain @gns-aip/sdk
```

## Quick Start

```typescript
import { createGnsAgent } from '@gns-aip/langchain';
import { generateAgentIdentity } from '@gns-aip/sdk';
import { ChatOpenAI } from '@langchain/openai';
import { TavilySearchResults } from '@langchain/community/tools/tavily_search';

// 1. Human principal keypair (stored on mobile, never leaves device)
import nacl from 'tweetnacl';
const humanKeypair = nacl.sign.keyPair();

// 2. Define H3 territory (Rome jurisdiction)
const territoryCells = ['871e8052affffff', '871e8050fffffff', '871e8051fffffff'];

// 3. Create GNS-governed agent
const agent = await createGnsAgent({
  humanKeypair,
  territoryCells,
  facets: ['read', 'execute'],
  riskLevel: 'MEDIUM',
  tools: [
    {
      name: 'web_search',
      description: 'Search the web for current information',
      requiredFacet: 'read',
      invoke: async (input, context) => {
        // context.chainHeader → add to outbound HTTP requests
        // context.agentPk    → agent's GNS identity
        const results = await new TavilySearchResults().invoke(input);
        return results;
      },
    },
  ],
  llm: new ChatOpenAI({ model: 'gpt-4o' }),
  purpose: 'Grid monitoring assistant — Rome region',
  onEscalation: async (request) => {
    // Show approval UI to human principal (e.g., push notification to GCRUMBS app)
    console.log(`⚠️  HITL required: ${request.operationDescription}`);
    console.log(`   Reason: ${request.reason}`);
    // In production: send to mobile app for biometric approval
    throw new Error('Human approval required — check your GCRUMBS app');
  },
});

// 4. Invoke
const result = await agent.invoke({ input: 'What is the current grid load in Rome?' });

console.log(result.output);
console.log(`Trust tier: ${result.complianceTier}`);
console.log(`Operations: ${result.operationsExecuted}`);
console.log(`Breadcrumbs: ${result.breadcrumbsCreated}`);

// 5. Compliance report (EU AI Act Art 13/14/17)
const report = agent.getComplianceReport();
console.log(`EU AI Act compliant: ${report.euAiActCompliance.overallCompliant}`);
```

## Advanced: Sub-Delegation (Manager → Worker)

```typescript
import { createGnsAgent } from '@gns-aip/langchain';
import { createSubDelegation } from '@gns-aip/sdk';

// Manager agent delegates to worker agent
const managerAgent = await createGnsAgent({
  humanKeypair,
  territoryCells: romeCells,
  facets: ['read', 'execute'],
  riskLevel: 'HIGH',
  maxSubDelegationDepth: 1,  // allows one more hop
  tools: [...managerTools],
  llm,
});

// Worker receives narrowed permissions from manager
const workerAgent = await createGnsAgent({
  humanKeypair,          // same human principal — chain verified
  territoryCells: [romeCells[0]],  // narrowed to single cell
  facets: ['read'],      // read-only subset
  riskLevel: 'LOW',
  tools: [...workerTools],
  llm,
});
```

## OIDC Integration (Okta/Ping)

```typescript
import { GnsOidcProvider } from '@gns-aip/sdk';

// Agent identity is also a valid OIDC subject
const provider = new GnsOidcProvider();
const info = agent.getIdentityInfo();

const idToken = provider.issueIdToken({
  publicKeyHex: info.publicKey,
  handle: info.gnsId,
  trustScore: info.trustScore,
  breadcrumbCount: info.breadcrumbCount,
  humanityProofHash: 'proof-hash',
  lastBreadcrumbAt: new Date().toISOString(),
  subjectType: 'ai_agent',
  agentId: info.gnsId,
}, {
  clientId: 'your-okta-client-id',
  scopes: ['openid', 'gns:trust', 'gns:agent'],
});
// → inject into Okta via Inline Hook
```

## Architecture

```
Your LangChain Agent
        │
        ▼
GnsDelegationTool (wraps each tool)
        │
        ├── HITL check (HitlEngine)
        │     ├── FIRST_OP → escalate to human
        │     ├── OP_COUNT_THRESHOLD → re-auth every N ops
        │     ├── TTL_EXPIRED → re-auth after window
        │     └── ALWAYS_ESCALATE_FACET → financial/emergency
        │
        ├── Drop breadcrumb (createVirtualBreadcrumb)
        │
        └── Execute tool with GnsToolContext
              ├── chainHeader → X-GNS-Chain HTTP header
              ├── agentPk → agent identity
              └── delegationCert → authorization proof
```

## EU AI Act Compliance

| Article | Requirement | GNS-AIP Implementation |
|---|---|---|
| Art 13 | Transparency | Signed audit log per operation |
| Art 14 | Human oversight | HITL engine with escalation triggers |
| Art 17 | Risk management | TierGate scoring by risk level |
| Art 26 | Responsibilities | `humanPrincipalPk` traces every action to human |

## License

Apache-2.0 — [GNS Foundation](https://gns.foundation)
