# Cliente GNSAgentSDK

```python
from gns_aip import GNSAgentSDK
async with GNSAgentSDK("https://gns-browser-production.up.railway.app") as sdk:
    ...
```

| Método | Descripción | Retorna |
|--------|-------------|---------|
| `provision_agent(...)` | Crear identidad de agente | `ProvisionResult` |
| `delegate_to_agent(...)` | Crear certificado de delegación | `DelegationCert` |
| `get_agent_manifest(id)` | Obtener manifiesto público | `AgentManifest` |
| `get_compliance(id)` | Consultar puntuación | `ComplianceScore` |
| `submit_breadcrumbs(id, crumbs)` | Enviar breadcrumbs | `BreadcrumbResult` |
