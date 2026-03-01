# GNSAgentSDK Client

## Constructor

```typescript
import { GNSAgentSDK } from '@gns-aip/sdk';

const sdk = new GNSAgentSDK({
  backendUrl: 'https://gns-browser-production.up.railway.app',
  timeout: 30000, // optional, default 30s
});
```

## Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `provisionAgent(opts)` | Create new agent identity | `ProvisionResult` |
| `delegateToAgent(opts)` | Create delegation certificate | `DelegationCert` |
| `getAgentManifest(id)` | Fetch public manifest | `AgentManifest` |
| `getCompliance(id)` | Query compliance score | `ComplianceScore` |
| `submitBreadcrumbs(id, crumbs)` | Submit breadcrumbs | `BreadcrumbResult` |

## Static Utilities

| Utility | Description |
|---------|-------------|
| `DelegationChain.verify(sdk, id)` | Walk chain to human root |
| `DelegationChain.checkScope(sdk, id, action)` | Check action authorization |
| `EscalationPolicy.evaluate(sdk, id, ctx?)` | Determine if escalation needed |
