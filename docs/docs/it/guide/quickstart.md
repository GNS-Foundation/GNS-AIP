# Avvio Rapido

Crea il tuo primo agente GNS-AIP in meno di 2 minuti.

## Scegli il Tuo Linguaggio

::: code-group

```bash [TypeScript]
npm install @gns-aip/sdk
```

```bash [Python]
pip install gns-aip
```

:::

## 1. Provisioning di un Agente

::: code-group

```typescript [TypeScript]
import { GNSAgentSDK } from '@gns-aip/sdk';

const sdk = new GNSAgentSDK({
  backendUrl: 'https://gns-browser-production.up.railway.app',
});

const agent = await sdk.provisionAgent({
  agentType: 'autonomous',
  agentHandle: 'il-mio-primo-agente',
  homeCells: ['8a2a1072b59ffff'], // Roma, Italia
});
```

```python [Python]
from gns_aip import GNSAgentSDK

async with GNSAgentSDK("https://gns-browser-production.up.railway.app") as sdk:
    agent = await sdk.provision_agent(
        agent_type="autonomous",
        agent_handle="il-mio-primo-agente",
        home_cells=["8a2a1072b59ffff"],  # Roma, Italia
    )
```

:::

## 2. Delega da un Umano

::: code-group

```typescript [TypeScript]
const cert = await sdk.delegateToAgent({
  principalPk: 'ed25519-chiave-pubblica-umana',
  agentId: agent.agentId,
  scope: {
    actions: ['search', 'code', 'email'],
    resources: ['*'],
  },
  territory: ['8a2a1072b59ffff'],
});
```

```python [Python]
from gns_aip import DelegationScope

cert = await sdk.delegate_to_agent(
    principal_pk="ed25519-chiave-pubblica-umana",
    agent_id=agent.agent_id,
    scope=DelegationScope(
        actions=["search", "code", "email"],
        resources=["*"],
    ),
    territory=["8a2a1072b59ffff"],
)
```

:::

## 3. Verifica la Conformità

::: code-group

```typescript [TypeScript]
const score = await sdk.getCompliance(agent.agentId);
// score.tier    → "VERIFIED"
// score.total   → 85
```

```python [Python]
score = await sdk.get_compliance(agent.agent_id)
# score.tier    → ComplianceTier.VERIFIED
# score.total   → 85
```

:::

## Cosa è Successo?

1. **Provisioning** — Il tuo agente ora ha un'identità crittografica Ed25519 sulla rete GNS
2. **Delega** — Un referente umano ha firmato un certificato autorizzando le azioni dell'agente
3. **Punteggio** — Il motore di conformità ha calcolato un punteggio in tempo reale su 4 dimensioni
4. **Cablaggio** — Ogni operazione del tuo agente ora produce breadcrumb che preservano la privacy
