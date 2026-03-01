# Client GNSAgentSDK

## Costruttore

```python
from gns_aip import GNSAgentSDK

async with GNSAgentSDK("https://gns-browser-production.up.railway.app") as sdk:
    ...
```

## Metodi

| Metodo | Descrizione | Ritorna |
|--------|-------------|---------|
| `provision_agent(...)` | Crea nuova identità agente | `ProvisionResult` |
| `delegate_to_agent(...)` | Crea certificato di delega | `DelegationCert` |
| `get_agent_manifest(id)` | Ottieni manifesto pubblico | `AgentManifest` |
| `get_compliance(id)` | Interroga punteggio conformità | `ComplianceScore` |
| `submit_breadcrumbs(id, crumbs)` | Invia breadcrumb | `BreadcrumbResult` |

Tutti i metodi sono async.
