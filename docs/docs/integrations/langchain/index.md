# LangChain Integration

`langchain-gns-aip` adds identity, delegation, and compliance to any LangChain agent.

## Install

```bash
npm install langchain-gns-aip @gns-aip/sdk
```

## Components

| Component | Purpose |
|-----------|---------|
| `GNSCallbackHandler` | Auto-collects breadcrumbs on every LLM call, tool use, chain step |
| `GNSDelegationTool` | Agent can verify its own authorization mid-conversation |
| `GNSComplianceRunnable` | Wraps any Runnable with compliance middleware |
| `GNSLangChainProvider` | One-call setup that creates all components |

## Quick Start

```typescript
import { GNSLangChainProvider } from 'langchain-gns-aip';

const gns = await GNSLangChainProvider.create({
  backendUrl: 'https://gns-browser-production.up.railway.app',
  agentType: 'autonomous',
  agentHandle: 'research-agent',
  homeCells: ['8a2a1072b59ffff'],
});

await gns.delegate('ed25519-human-pk', { actions: ['search', 'code'] });

// Wire into any LangChain agent
const executor = new AgentExecutor({
  agent: myAgent,
  tools: [...tools, gns.delegationTool],
  callbacks: [gns.callbackHandler],
});
```

## Privacy

The callback handler **never** records prompts, completions, or tool arguments. Only metadata: timing, token counts, tool names, serialized key lengths. 30 tests.
