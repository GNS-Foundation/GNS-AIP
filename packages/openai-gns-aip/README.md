# openai-gns-aip

GNS-AIP identity, compliance, and delegation for the [OpenAI Agents SDK](https://github.com/openai/openai-agents-js).

Part of the [GNS-AIP](https://github.com/GNS-Foundation/GNS-AIP) monorepo — the Agent Identity Protocol for the EU AI Act era.

## Quick Start

```typescript
import { Agent, run, BatchTraceProcessor, setTraceProcessors } from '@openai/agents';
import { GNSAgentHooks, GNSTracingExporter, createGNSDelegationTool } from 'openai-gns-aip';

// 1. Provision agent identity with lifecycle hooks
const hooks = await GNSAgentHooks.provision({
  backendUrl: 'https://gns-browser-production.up.railway.app',
  agentType: 'autonomous',
  agentHandle: 'my-agent',
  homeCells: ['8a2a1072b59ffff'],
});

// 2. Delegate to a human principal
await hooks.delegate('ed25519-human-public-key', {
  scope: { actions: ['search', 'code'] },
});

// 3. Set up tracing exporter for compliance audit trail
const exporter = new GNSTracingExporter({
  backendUrl: 'https://gns-browser-production.up.railway.app',
  agentId: hooks.id!,
});
setTraceProcessors([new BatchTraceProcessor(exporter)]);

// 4. Create agent with GNS-AIP hooks + delegation tool
const agent = new Agent({
  name: 'Compliant Agent',
  instructions: 'Before sensitive actions, verify your authorization using gns_check_delegation.',
  hooks,
  tools: [
    createGNSDelegationTool({
      backendUrl: 'https://gns-browser-production.up.railway.app',
      agentId: hooks.id!,
    }),
  ],
});

// 5. Run — everything is automatically tracked
const result = await run(agent, 'Search for EU AI Act compliance requirements');
console.log(result.finalOutput);
```

## Features

### GNSAgentHooks — Lifecycle Identity

Extends the OpenAI Agents SDK `AgentHooks` interface to create breadcrumbs for every lifecycle event:

| Hook | Event |
|------|-------|
| `onStart` | Agent begins execution |
| `onEnd` | Agent produces final output |
| `onHandoff` | Control transfers to another agent |
| `onToolStart` | Tool execution begins |
| `onToolEnd` | Tool execution completes |

Privacy by design — hooks record metadata (timing, tool names, output lengths) but **never** log actual prompts, completions, or tool inputs.

### GNSTracingExporter — Compliance Audit Trail

Plugs into the OpenAI Agents SDK's built-in tracing system via `BatchTraceProcessor`. Every trace span becomes a GNS-AIP breadcrumb with:

- Span classification: `oai_agent`, `oai_generation`, `oai_tool`, `oai_handoff`, `oai_guardrail`
- Safe metadata: model name, token counts, duration, error status
- Zero content leakage: prompts and completions are never stored

### createGNSDelegationTool — In-Conversation Verification

A function tool the agent can call mid-conversation to verify its own authorization:

```
Agent: "Let me verify my authorization before searching..."
→ calls gns_check_delegation({ action: "search" })
→ { authorized: true, complianceTier: "VERIFIED", summary: "✓ Agent authorized..." }
```

### createGNSComplianceGuardrail — Input Gate

An input guardrail that blocks agent execution if compliance tier is below minimum:

```typescript
const agent = new Agent({
  name: 'Sensitive Agent',
  inputGuardrails: [
    createGNSComplianceGuardrail({
      agentId: hooks.id!,
      minimumTier: 'VERIFIED',
    }),
  ],
});
```

## Compliance Tiers

| Tier | Score | Requirements |
|------|-------|-------------|
| SHADOW | 0-24 | No delegation, no history |
| BASIC | 25-49 | Valid delegation chain |
| VERIFIED | 50-74 | + Territory compliance + operation history |
| TRUSTED | 75-89 | + Staking + clean record |
| SOVEREIGN | 90-100 | Full compliance, all checks passing |

## Architecture

```
┌────────────────────────────────────────────┐
│          Your OpenAI Agent                  │
│  Agent({ hooks, tools, inputGuardrails })   │
├────────────────────────────────────────────┤
│    openai-gns-aip (this package)            │
│  GNSAgentHooks │ GNSTracingExporter │ Tool  │
├────────────────────────────────────────────┤
│         @gns-aip/sdk (core SDK)             │
│    provision │ delegate │ breadcrumbs       │
├────────────────────────────────────────────┤
│         GNS Backend (Railway)               │
│    /agents │ /compliance │ /breadcrumbs     │
└────────────────────────────────────────────┘
```

## License

MIT — GNS Foundation
