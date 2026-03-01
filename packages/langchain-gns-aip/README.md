# langchain-gns-aip

**GNS Agent Identity Protocol for LangChain** — Give your AI agents verifiable identity, delegation chains, and compliance scoring.

[![npm version](https://img.shields.io/npm/v/langchain-gns-aip)](https://www.npmjs.com/package/langchain-gns-aip)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why?

AI agents are deploying in regulated environments — healthcare, finance, government. Regulators (EU AI Act, FINMA, FDA) are asking: **Who built this agent? Who authorized it? What did it do?**

`langchain-gns-aip` answers all three questions by wrapping any LangChain agent with:

- **Verifiable Identity** — Ed25519 cryptographic keypair, not just a string name
- **Delegation Chains** — Provable link from agent → deployer → human principal
- **Compliance Scoring** — Real-time TierGate algorithm based on operational behavior
- **Audit Trail** — Every LLM call, tool use, and chain execution becomes a signed breadcrumb

## Installation

```bash
npm install langchain-gns-aip @gns-aip/sdk
```

Peer dependencies: `@langchain/core >= 0.2.0`, `zod >= 3.22.0`

## Compliance in 5 Minutes

Three function calls. That's the rule — if integration requires more than 3 lines of code change, it's failed.

### Step 1: Provision

```typescript
import { GNSAgentIdentity } from 'langchain-gns-aip';

const identity = await GNSAgentIdentity.provision({
  agentType: 'autonomous',
  homeCells: ['8a2a1072b59ffff'],  // H3 cell — Rome, Italy
  jurisdiction: 'EU',
  handle: 'my-research-bot',
  manifest: {
    name: 'Research Assistant',
    version: '1.0.0',
    capabilities: ['web-search', 'summarization'],
  },
});

console.log(`Agent PK: ${identity.publicKey}`);
```

### Step 2: Delegate

```typescript
// Link agent to human principal (the person responsible)
await identity.delegate('HUMAN_PRINCIPAL_PUBLIC_KEY_HEX', {
  scope: {
    actions: ['search', 'summarize', 'draft'],
    maxCostPerAction: 0.10,
  },
  territory: ['8a2a1072b59ffff'],  // EU territory cells
  expiresAt: '2026-12-31T23:59:59Z',
  escalationPolicy: 'notify',      // notify human if scope exceeded
});
```

### Step 3: Wrap

```typescript
import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents';

// Your existing LangChain agent
const model = new ChatOpenAI({ model: 'gpt-4' });
const agent = await createOpenAIFunctionsAgent({ llm: model, tools, prompt });
const executor = new AgentExecutor({ agent, tools });

// One line to add compliance
const compliantExecutor = identity.wrap(executor);

// Use exactly as before — breadcrumbs are automatic
const result = await compliantExecutor.invoke({ input: 'Research quantum computing' });
```

**Done.** Every LLM call, tool use, and chain execution is now a signed breadcrumb feeding the compliance score.

## Components

### GNSAgentIdentity

The core wrapper. Handles provisioning, delegation, breadcrumb management, and compliance queries.

```typescript
// Restore from existing key (no re-provisioning needed)
const identity = await GNSAgentIdentity.fromSecretKey(process.env.AGENT_SECRET_KEY);

// Check compliance score
const score = await identity.getCompliance();
console.log(`Tier: ${score.tier}, Score: ${score.total_score}/100`);

// Get public manifest (shareable with regulators)
const manifest = await identity.getManifest();
```

### GNSComplianceCallback

LangChain callback handler that creates audit breadcrumbs for every event.

```typescript
import { GNSComplianceCallback } from 'langchain-gns-aip';

const callback = new GNSComplianceCallback({
  identity,
  autoBreadcrumb: true,
  flushThreshold: 50,
  verbose: true,  // logs events to console
});

// Attach to any chain
const chain = prompt.pipe(model).withConfig({ callbacks: [callback] });
await chain.invoke({ input: 'Hello' });

// Get session audit report
const report = await callback.generateAuditReport();
console.log(`Events: ${report.sessionEvents}`);
console.log(`Summary:`, report.eventSummary);
```

The callback **never logs prompts or outputs** — only metadata (lengths, types, counts). Privacy by design.

### GNSDelegationTool

Let your agent check its own authorization mid-conversation.

```typescript
// Add to agent's tool belt
const delegationTool = identity.createDelegationTool();
const tools = [searchTool, calculatorTool, delegationTool];

// Agent can now call: gns_check_delegation({ action: "send_payment" })
// Returns: { authorized: true, tier: "trusted", scope: {...} }
```

This enables patterns like:

> **Agent:** "Before processing this payment, let me verify my authorization..."
> *→ calls gns_check_delegation({ action: "send_payment", territory: "8a2a..." })*
> **Agent:** "I'm authorized for payment actions in the EU territory. Proceeding."

## Compliance Tiers

| Tier | Score | Meaning |
|------|-------|---------|
| **Sovereign** | 90–100 | Full autonomous operation, proven track record |
| **Trusted** | 70–89 | Standard operations, valid delegation chain |
| **Standard** | 50–69 | Basic operations, building history |
| **Provisional** | 25–49 | New agent, limited operations |
| **Unverified** | 0–24 | No delegation, no history |

Score is calculated from 4 components (25 points each):
- **Delegation** — Valid chain to a human principal?
- **Territory** — Operating within authorized H3 cells?
- **History** — Breadcrumb count and consistency
- **Staking** — GNS tokens staked as commitment

## Backend

By default, the package connects to the GNS production backend. For development:

```typescript
const identity = await GNSAgentIdentity.provision({
  agentType: 'tool',
  homeCells: ['8a2a1072b59ffff'],
  apiUrl: 'http://localhost:3000',  // local GNS node
});
```

## Contributing

PRs welcome. This package is part of the [GNS-AIP](https://github.com/GNS-Foundation/GNS-AIP) ecosystem.

```bash
git clone https://github.com/GNS-Foundation/langchain-gns-aip
cd langchain-gns-aip
npm install
npm test
```

## License

MIT © GNS Foundation
