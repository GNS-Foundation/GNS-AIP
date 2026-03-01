# Python SDK

`gns-aip` is the core Python SDK for GNS-AIP. All Python framework integrations (CrewAI, AutoGen) build on this package.

## Install

```bash
pip install gns-aip
```

## Features

- **GNSAgentSDK** — Async httpx client with context manager support
- **Pydantic v2 models** — ComplianceScore, AgentManifest, DelegationCert, Breadcrumb
- **ComplianceTier** — Enum with comparison operators (`<`, `>=`, etc.)
- **DelegationChain** — Walk and verify delegation chains
- **EscalationPolicy** — Evaluate when to escalate to human

## Quick Example

```python
from gns_aip import GNSAgentSDK, DelegationScope, DelegationChain

async with GNSAgentSDK("https://gns-browser-production.up.railway.app") as sdk:
    agent = await sdk.provision_agent(
        agent_type="autonomous",
        agent_handle="my-agent",
        home_cells=["8a2a1072b59ffff"],
    )
    
    await sdk.delegate_to_agent(
        principal_pk="ed25519-human-pk",
        agent_id=agent.agent_id,
        scope=DelegationScope(actions=["search", "code"]),
    )
    
    chain = await DelegationChain.verify(sdk, agent.agent_id)
    score = await sdk.get_compliance(agent.agent_id)
```

## Requirements

Python >= 3.10, httpx >= 0.25, pydantic >= 2.0. 37 tests passing.
