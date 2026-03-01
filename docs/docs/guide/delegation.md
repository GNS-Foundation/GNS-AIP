# Delegation

Delegation certificates create a cryptographic chain from human principal to AI agent.

## How Delegation Works

A **DelegationCert** is a signed certificate that says: "I, human `X`, authorize agent `Y` to perform actions `Z` in territory `T` until time `E`."

```
Human Principal ──[signs cert]──→ Agent
     Ed25519 pk                    Ed25519 pk
```

## Scope

Every delegation has a **scope** that limits what the agent can do:

```typescript
const cert = await sdk.delegateToAgent({
  principalPk: 'ed25519-human-pk',
  agentId: agent.agentId,
  scope: {
    actions: ['search', 'code'],  // Only these actions
    resources: ['public-data'],   // Only these resources
  },
  territory: ['8a2a1072b59ffff'],
  expiresAt: '2026-12-31T23:59:59Z',
});
```

Use `"*"` for wildcard (all actions/resources).

## Chain Verification

Delegation chains can be walked programmatically:

::: code-group

```typescript [TypeScript]
import { DelegationChain } from '@gns-aip/sdk';

const chain = await DelegationChain.verify(sdk, agentId);
// chain.valid     → true (reaches human root)
// chain.depth     → 1 (direct delegation)
// chain.humanRoot → "ed25519-human-pk"
```

```python [Python]
from gns_aip import DelegationChain

chain = await DelegationChain.verify(sdk, agent_id)
# chain["valid"]      → True
# chain["depth"]      → 1
# chain["human_root"] → "ed25519-human-pk"
```

:::

## Scope Checking

Verify an agent is authorized for a specific action:

```typescript
const result = await DelegationChain.checkScope(sdk, agentId, 'payment');
// result.authorized → false (not in scope)
// result.reason → "Action 'payment' not found in delegation scope"
```
