# Vercel AI SDK Integration

`vercel-gns-aip` adds compliance headers and telemetry to Vercel AI SDK responses.

## Install

```bash
npm install vercel-gns-aip @gns-aip/sdk
```

## Components

| Component | Purpose |
|-----------|---------|
| `createGNSMiddleware` | Middleware object with `wrapGenerate` and `wrapStream` |
| `createGNSTelemetry` | Telemetry config for `experimental_telemetry` |
| `GNSVercelProvider` | One-call setup for middleware + telemetry |

## Quick Start

```typescript
import { GNSVercelProvider } from 'vercel-gns-aip';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

const gns = await GNSVercelProvider.create({
  backendUrl: 'https://gns-browser-production.up.railway.app',
  agentType: 'autonomous',
});
await gns.delegate('ed25519-human-pk');

const result = await streamText({
  model: openai('gpt-4'),
  prompt: 'Research EU AI Act',
  experimental_telemetry: gns.telemetry,
});

// Response headers include:
// X-GNS-Agent-Id, X-GNS-Compliance-Tier, X-GNS-Delegation-Valid
```

Edge-compatible (runs in Cloudflare Workers, Vercel Edge Functions). 42 tests.
