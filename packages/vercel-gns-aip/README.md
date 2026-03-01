# vercel-gns-aip

GNS-AIP identity, compliance, and delegation for the [Vercel AI SDK](https://ai-sdk.dev).

Part of the [GNS-AIP](https://github.com/GNS-Foundation/GNS-AIP) monorepo — the Agent Identity Protocol for the EU AI Act era.

## Quick Start

```typescript
import { wrapLanguageModel, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { GNSIdentityProvider } from 'vercel-gns-aip';

// 1. One-call setup: provisions identity + creates middleware + tool
const gns = await GNSIdentityProvider.create({
  backendUrl: 'https://gns-browser-production.up.railway.app',
  agentType: 'autonomous',
  agentHandle: 'my-nextjs-agent',
  homeCells: ['8a2a1072b59ffff'],
});

// 2. Delegate to human principal
await gns.delegate('ed25519-human-public-key', {
  scope: { actions: ['search', 'code'] },
});

// 3. Wrap any model with compliance middleware
const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: gns.middleware,
});

// 4. Use with delegation tool
const result = await generateText({
  model,
  prompt: 'Search for EU AI Act compliance requirements',
  tools: { gns_check_delegation: gns.delegationTool },
});
```

## Features

### Language Model Middleware

The core integration — wraps any model with GNS-AIP compliance tracking. Every `generateText` / `streamText` / `generateObject` call automatically creates breadcrumbs.

```typescript
import { createGNSComplianceMiddleware } from 'vercel-gns-aip';

const middleware = createGNSComplianceMiddleware({
  agentId: 'agent-001',
  backendUrl: 'https://gns-browser-production.up.railway.app',
  minimumTier: 'VERIFIED', // optional: block calls if compliance too low
});

const model = wrapLanguageModel({ model: openai('gpt-4o'), middleware });
```

What the middleware tracks (privacy-preserving):

| Tracked | NOT Tracked |
|---------|-------------|
| Token counts | Prompts |
| Model name | Completions |
| Call duration | Tool inputs |
| Finish reason | Tool outputs |
| Tool names | User data |
| Error types | Error messages |

### Compliance Tier Guardrail

Optional built-in guardrail that blocks LLM calls if the agent's compliance tier is below minimum:

```typescript
const middleware = createGNSComplianceMiddleware({
  agentId: 'agent-001',
  minimumTier: 'VERIFIED',
});
// Throws: "GNS-AIP: Agent compliance tier SHADOW is below minimum VERIFIED"
```

### Delegation Tool

Agents can verify their own authorization mid-conversation:

```typescript
const result = await generateText({
  model,
  prompt: 'Before searching, verify my authorization',
  tools: {
    gns_check_delegation: createGNSDelegationTool({
      agentId: 'agent-001',
    }),
  },
});
```

### GNSIdentityProvider

All-in-one factory that provisions identity + creates middleware + tool:

```typescript
const gns = await GNSIdentityProvider.create({ ... });

gns.middleware       // → pass to wrapLanguageModel()
gns.delegationTool   // → pass to tools: { }
gns.agentId          // → 'agent-001'
gns.publicKey        // → Ed25519 public key
gns.isDelegated      // → true/false
gns.getStats()       // → { totalCalls, totalTokens, ... }
gns.getCompliance()  // → { tier: 'VERIFIED', total: 85, ... }
gns.flush()          // → submit pending breadcrumbs
```

## Architecture

```
┌────────────────────────────────────────────┐
│    Your Next.js / Node.js Application       │
│    generateText({ model, tools })           │
├────────────────────────────────────────────┤
│    vercel-gns-aip (this package)            │
│  Middleware │ DelegationTool │ Provider      │
├────────────────────────────────────────────┤
│         @gns-aip/sdk (core SDK)             │
│    provision │ delegate │ breadcrumbs       │
├────────────────────────────────────────────┤
│         GNS Backend (Railway)               │
│    /agents │ /compliance │ /breadcrumbs     │
└────────────────────────────────────────────┘
```

## Next.js Route Handler Example

```typescript
// app/api/chat/route.ts
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { GNSIdentityProvider } from 'vercel-gns-aip';

// Initialize once at module level
const gns = await GNSIdentityProvider.create({
  backendUrl: process.env.GNS_BACKEND_URL!,
  agentType: 'supervised',
  minimumTier: 'VERIFIED',
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: wrapLanguageModel({
      model: openai('gpt-4o'),
      middleware: gns.middleware,
    }),
    messages,
    tools: { gns_check_delegation: gns.delegationTool },
  });

  return result.toDataStreamResponse();
}
```

## License

MIT — GNS Foundation
