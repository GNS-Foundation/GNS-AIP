# GNSAgentSDK Client

## Constructor

```python
from gns_aip import GNSAgentSDK

# Context manager (recommended)
async with GNSAgentSDK("https://gns-browser-production.up.railway.app") as sdk:
    ...

# Manual
sdk = GNSAgentSDK("https://gns-browser-production.up.railway.app", timeout=30)
```

## Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `provision_agent(...)` | Create new agent identity | `ProvisionResult` |
| `delegate_to_agent(...)` | Create delegation certificate | `DelegationCert` |
| `get_agent_manifest(id)` | Fetch public manifest | `AgentManifest` |
| `get_compliance(id)` | Query compliance score | `ComplianceScore` |
| `submit_breadcrumbs(id, crumbs)` | Submit breadcrumbs | `BreadcrumbResult` |

All methods are async. Backend responses are auto-converted from camelCase to snake_case Python models.

## Static Utilities

| Utility | Description |
|---------|-------------|
| `DelegationChain.verify(sdk, id)` | Walk chain to human root |
| `DelegationChain.check_scope(sdk, id, action)` | Check action authorization |
| `EscalationPolicy.evaluate(sdk, id, ctx?)` | Determine if escalation needed |
