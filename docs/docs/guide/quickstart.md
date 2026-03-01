# Quick Start

Provision your first GNS-AIP agent in under 2 minutes.

## Choose Your Language

::: code-group

```bash [TypeScript]
npm install @gns-aip/sdk
```

```bash [Python]
pip install gns-aip
```

:::

## 1. Provision an Agent

::: code-group

```typescript [TypeScript]
import { GNSAgentSDK } from '@gns-aip/sdk';

const sdk = new GNSAgentSDK({
  backendUrl: 'https://gns-browser-production.up.railway.app',
});

const agent = await sdk.provisionAgent({
  agentType: 'autonomous',
  agentHandle: 'my-first-agent',
  homeCells: ['8a2a1072b59ffff'], // Rome, Italy
});

console.log(agent.agentId);  // "agent-abc123"
console.log(agent.pkRoot);   // Ed25519 public key
```

```python [Python]
from gns_aip import GNSAgentSDK

async with GNSAgentSDK("https://gns-browser-production.up.railway.app") as sdk:
    agent = await sdk.provision_agent(
        agent_type="autonomous",
        agent_handle="my-first-agent",
        home_cells=["8a2a1072b59ffff"],  # Rome, Italy
    )
    print(agent.agent_id)   # "agent-abc123"
    print(agent.pk_root)    # Ed25519 public key
```

:::

## 2. Delegate from a Human

::: code-group

```typescript [TypeScript]
const cert = await sdk.delegateToAgent({
  principalPk: 'ed25519-human-public-key',
  agentId: agent.agentId,
  scope: {
    actions: ['search', 'code', 'email'],
    resources: ['*'],
  },
  territory: ['8a2a1072b59ffff'],
});
// cert.certHash — unique certificate ID
// cert.chainDepth — 1 (direct human delegation)
```

```python [Python]
from gns_aip import DelegationScope

cert = await sdk.delegate_to_agent(
    principal_pk="ed25519-human-public-key",
    agent_id=agent.agent_id,
    scope=DelegationScope(
        actions=["search", "code", "email"],
        resources=["*"],
    ),
    territory=["8a2a1072b59ffff"],
)
```

:::

## 3. Check Compliance

::: code-group

```typescript [TypeScript]
const score = await sdk.getCompliance(agent.agentId);
// score.tier    → "VERIFIED"
// score.total   → 85
// score.delegation → 25 (valid chain)
// score.territory  → 20 (consistent cells)
```

```python [Python]
score = await sdk.get_compliance(agent.agent_id)
# score.tier    → ComplianceTier.VERIFIED
# score.total   → 85
```

:::

## 4. Wire Into Your Framework

Now plug the identity into your AI framework of choice:

::: code-group

```typescript [LangChain]
import { GNSCallbackHandler, GNSDelegationTool } from 'langchain-gns-aip';

const handler = new GNSCallbackHandler(sdk, agent.agentId);
const tool = new GNSDelegationTool(sdk, agent.agentId);

const agent = new AgentExecutor({
  agent: myAgent,
  tools: [...tools, tool],
  callbacks: [handler],
});
```

```typescript [OpenAI Agents]
import { createGNSHooks } from 'openai-gns-aip';

const hooks = createGNSHooks(sdk, agent.agentId);
const openaiAgent = new Agent({
  name: 'my-agent',
  hooks: hooks,
  tools: [delegationTool],
});
```

```typescript [Vercel AI]
import { createGNSMiddleware } from 'vercel-gns-aip';

const middleware = createGNSMiddleware(sdk, agent.agentId);
const result = await streamText({
  model: openai('gpt-4'),
  prompt: 'Research EU AI Act',
  experimental_telemetry: middleware.telemetry,
});
```

```python [CrewAI]
from crewai_gns_aip import GNSCrewProvider

gns = await GNSCrewProvider.create(
    backend_url="https://gns-browser-production.up.railway.app",
    agent_type="autonomous",
    home_cells=["8a2a1072b59ffff"],
)
agent = Agent(
    role="Researcher",
    tools=[gns.delegation_tool],
    step_callback=gns.step_callback,
)
```

```python [AutoGen]
from autogen_gns_aip import GNSAutoGenProvider

gns = await GNSAutoGenProvider.create(
    backend_url="https://gns-browser-production.up.railway.app",
    agent_type="autonomous",
)
gns.register_with(caller=assistant, executor=user_proxy)
```

:::

## What Just Happened?

1. **Provisioned** — Your agent now has a cryptographic Ed25519 identity on the GNS network
2. **Delegated** — A human principal signed a certificate authorizing the agent's actions
3. **Scored** — The compliance engine computed a real-time score across 4 dimensions
4. **Wired** — Every operation your agent performs now produces privacy-preserving breadcrumbs

The agent's identity, delegation chain, and compliance score are verifiable by any third party at any time. That's the difference between "we log stuff" and "cryptographic proof of human authorization."

## Next Steps

- **[Architecture](/guide/architecture)** — How the layers connect
- **[Provisioning deep-dive](/guide/provisioning)** — Agent types, home cells, staking
- **[Delegation deep-dive](/guide/delegation)** — Chain verification, scope, territory
