# gns-aip

Python SDK for the **GNS-AIP Agent Identity Protocol** — proving AI agents are human-authorized through Proof-of-Trajectory.

Part of the [GNS-AIP](https://github.com/GNS-Foundation/GNS-AIP) monorepo.

## Install

```bash
pip install gns-aip
```

## Quick Start

```python
from gns_aip import GNSAgentSDK, DelegationChain, DelegationScope, Breadcrumb

async with GNSAgentSDK("https://gns-browser-production.up.railway.app") as sdk:

    # 1. Provision an agent identity
    result = await sdk.provision_agent(
        agent_type="autonomous",
        agent_handle="my-python-agent",
        home_cells=["8a2a1072b59ffff"],
    )
    print(f"Agent: {result.agent_id}")
    print(f"Public Key: {result.pk_root}")

    # 2. Delegate from human principal
    cert = await sdk.delegate_to_agent(
        principal_pk="ed25519-human-public-key",
        agent_id=result.agent_id,
        scope=DelegationScope(actions=["search", "code", "email"]),
        territory=["8a2a1072b59ffff"],
    )
    print(f"Delegation: depth={cert.chain_depth}, active={cert.is_active}")

    # 3. Verify delegation chain
    chain = await DelegationChain.verify(sdk, result.agent_id)
    print(f"Chain valid: {chain['valid']}, human root: {chain['human_root']}")

    # 4. Check action authorization
    check = await DelegationChain.check_scope(sdk, result.agent_id, "search")
    print(f"Search authorized: {check['authorized']}")

    # 5. Submit compliance breadcrumbs
    breadcrumbs = [
        Breadcrumb(
            h3_cell="8a2a1072b59ffff",
            operation_type="llm_call",
            operation_hash="hash-001",
            metadata={"model": "gpt-4o", "tokens": 150},
        )
    ]
    await sdk.submit_breadcrumbs(result.agent_id, breadcrumbs)

    # 6. Query compliance
    compliance = await sdk.get_compliance(result.agent_id)
    print(f"Tier: {compliance.tier.value}, Score: {compliance.total}/100")
```

## API Reference

### GNSAgentSDK

| Method | Description |
|--------|-------------|
| `provision_agent()` | Create a new agent identity with Ed25519 keypair |
| `delegate_to_agent()` | Delegate authority from human to agent |
| `get_agent_manifest()` | Retrieve full agent manifest |
| `get_compliance()` | Get compliance score and tier |
| `submit_breadcrumbs()` | Submit operation breadcrumbs |

### DelegationChain

| Method | Description |
|--------|-------------|
| `verify(sdk, agent_id)` | Verify chain back to human root |
| `check_scope(sdk, agent_id, action)` | Check if action is authorized |

### EscalationPolicy

| Method | Description |
|--------|-------------|
| `evaluate(sdk, agent_id)` | Check if escalation is needed |

### Models

| Model | Description |
|-------|-------------|
| `ComplianceTier` | SHADOW < BASIC < VERIFIED < TRUSTED < SOVEREIGN |
| `DelegationScope` | Actions and resources permitted |
| `Breadcrumb` | Privacy-preserving operation record |
| `ComplianceScore` | Tier + component scores |
| `AgentManifest` | Full agent identity document |

## Compliance Tiers

```
SHADOW     →  New agent, no delegation
BASIC      →  Delegated, minimal history
VERIFIED   →  Active breadcrumbs, valid chain
TRUSTED    →  Long history, staking
SOVEREIGN  →  Full compliance, organization-backed
```

## Framework Wrappers

This SDK is the foundation for framework-specific wrappers:

- `crewai-gns-aip` — CrewAI integration (5.5)
- `autogen-gns-aip` — AutoGen integration (5.6)

## Development

```bash
pip install -e ".[dev]"
pytest tests/ -v
ruff check gns_aip/
mypy gns_aip/
```

## License

MIT — GNS Foundation
