# Inicio Rápido

Crea tu primer agente GNS-AIP en menos de 2 minutos.

## Elige Tu Lenguaje

::: code-group

```bash [TypeScript]
npm install @gns-aip/sdk
```

```bash [Python]
pip install gns-aip
```

:::

## 1. Aprovisionar un Agente

::: code-group

```typescript [TypeScript]
import { GNSAgentSDK } from '@gns-aip/sdk';

const sdk = new GNSAgentSDK({
  backendUrl: 'https://gns-browser-production.up.railway.app',
});

const agent = await sdk.provisionAgent({
  agentType: 'autonomous',
  agentHandle: 'mi-primer-agente',
  homeCells: ['8a2a1072b59ffff'], // Roma, Italia
});
```

```python [Python]
from gns_aip import GNSAgentSDK

async with GNSAgentSDK("https://gns-browser-production.up.railway.app") as sdk:
    agent = await sdk.provision_agent(
        agent_type="autonomous",
        agent_handle="mi-primer-agente",
        home_cells=["8a2a1072b59ffff"],  # Roma, Italia
    )
```

:::

## 2. Delegar desde un Humano

::: code-group

```typescript [TypeScript]
const cert = await sdk.delegateToAgent({
  principalPk: 'ed25519-clave-publica-humana',
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
    principal_pk="ed25519-clave-publica-humana",
    agent_id=agent.agent_id,
    scope=DelegationScope(
        actions=["search", "code", "email"],
        resources=["*"],
    ),
    territory=["8a2a1072b59ffff"],
)
```

:::

## 3. Verificar Cumplimiento

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

## ¿Qué Acaba de Pasar?

1. **Aprovisionamiento** — Tu agente ahora tiene una identidad criptográfica Ed25519 en la red GNS
2. **Delegación** — Un principal humano firmó un certificado autorizando las acciones del agente
3. **Puntuación** — El motor de cumplimiento calculó una puntuación en tiempo real en 4 dimensiones
4. **Cableado** — Cada operación de tu agente ahora produce breadcrumbs que preservan la privacidad
