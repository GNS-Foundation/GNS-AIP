# OpenAI Agents SDK Integration

`openai-gns-aip` adds identity and compliance to OpenAI Agents SDK agents via lifecycle hooks.

## Install

```bash
npm install openai-gns-aip @gns-aip/sdk
```

## Components

| Component | Purpose |
|-----------|---------|
| `createGNSHooks` | Lifecycle hooks for Agent `onStart`, `onEnd`, `onToolStart`, etc. |
| `createDelegationTool` | OpenAI-compatible tool for in-conversation authorization checks |
| `GNSOpenAIProvider` | One-call setup that creates hooks + tool |

## Quick Start

```typescript
import { GNSOpenAIProvider } from 'openai-gns-aip';
import { Agent, run } from '@openai/agents';

const gns = await GNSOpenAIProvider.create({
  backendUrl: 'https://gns-browser-production.up.railway.app',
  agentType: 'autonomous',
});
await gns.delegate('ed25519-human-pk');

const agent = new Agent({
  name: 'researcher',
  instructions: 'You are a research assistant.',
  tools: [gns.delegationTool],
  hooks: gns.hooks,
});

const result = await run(agent, 'Research EU AI Act requirements');
```

52 tests covering hooks, tool, provider, and full lifecycle flows.
