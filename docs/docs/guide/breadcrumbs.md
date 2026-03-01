# Breadcrumbs

Breadcrumbs are privacy-preserving operation logs that create an unfakeable audit trail.

## What Gets Recorded

| ✅ Recorded | ❌ Never Recorded |
|-------------|-------------------|
| Timestamp | Prompts |
| H3 cell | Completions |
| Tool name | Tool inputs |
| Output length | Tool outputs |
| Operation type | User data |
| Step number | Conversation content |

This is enforced at the framework wrapper level. The backend API never sees agent content.

## Submitting Breadcrumbs

::: code-group

```typescript [TypeScript]
import { Breadcrumb } from '@gns-aip/sdk';

await sdk.submitBreadcrumbs(agentId, [
  {
    h3Cell: '8a2a1072b59ffff',
    operationType: 'llm_call',
    operationHash: 'hash-of-metadata',
    timestamp: new Date().toISOString(),
    metadata: { model: 'gpt-4', outputLength: 1523 },
  },
]);
```

```python [Python]
from gns_aip import Breadcrumb

await sdk.submit_breadcrumbs(agent_id, [
    Breadcrumb(
        h3_cell="8a2a1072b59ffff",
        operation_type="llm_call",
        operation_hash="hash-of-metadata",
        metadata={"model": "gpt-4", "output_length": 1523},
    ),
])
```

:::

## Automatic Collection

Framework integrations collect breadcrumbs automatically — you don't need to call `submitBreadcrumbs` directly:

- **LangChain**: `GNSCallbackHandler` records on every LLM call, tool use, and chain step
- **OpenAI**: Lifecycle hooks fire on `onStart`, `onEnd`, `onToolStart`, `onToolEnd`
- **Vercel AI**: Middleware telemetry records on every `streamText` / `generateText`
- **CrewAI**: `step_callback` and `task_callback` fire per step and per task
- **AutoGen**: `register_reply` hook fires per message exchange

## Epochs

When breadcrumb count reaches a threshold, the backend creates an **epoch** — a signed aggregate that summarizes the breadcrumb batch. Epochs are the unit of historical compliance scoring.
