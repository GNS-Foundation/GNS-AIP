# Cliente GNSAgentSDK

```typescript
import { GNSAgentSDK } from '@gns-aip/sdk';
const sdk = new GNSAgentSDK({ backendUrl: 'https://gns-browser-production.up.railway.app' });
```

| Método | Descripción | Retorna |
|--------|-------------|---------|
| `provisionAgent(opts)` | Crear identidad de agente | `ProvisionResult` |
| `delegateToAgent(opts)` | Crear certificado de delegación | `DelegationCert` |
| `getAgentManifest(id)` | Obtener manifiesto público | `AgentManifest` |
| `getCompliance(id)` | Consultar puntuación | `ComplianceScore` |
| `submitBreadcrumbs(id, crumbs)` | Enviar breadcrumbs | `BreadcrumbResult` |
