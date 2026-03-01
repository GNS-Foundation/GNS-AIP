# Client GNSAgentSDK

## Costruttore

```typescript
import { GNSAgentSDK } from '@gns-aip/sdk';

const sdk = new GNSAgentSDK({
  backendUrl: 'https://gns-browser-production.up.railway.app',
  timeout: 30000,
});
```

## Metodi

| Metodo | Descrizione | Ritorna |
|--------|-------------|---------|
| `provisionAgent(opts)` | Crea nuova identità agente | `ProvisionResult` |
| `delegateToAgent(opts)` | Crea certificato di delega | `DelegationCert` |
| `getAgentManifest(id)` | Ottieni manifesto pubblico | `AgentManifest` |
| `getCompliance(id)` | Interroga punteggio conformità | `ComplianceScore` |
| `submitBreadcrumbs(id, crumbs)` | Invia breadcrumb | `BreadcrumbResult` |
