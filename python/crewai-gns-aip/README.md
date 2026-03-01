# crewai-gns-aip

GNS-AIP identity, compliance, and delegation for [CrewAI](https://docs.crewai.com) agents.

Part of the [GNS-AIP](https://github.com/GNS-Foundation/GNS-AIP) monorepo.

## Install

```bash
pip install crewai-gns-aip
```

## Quick Start

```python
from crewai import Agent, Task, Crew
from crewai_gns_aip import GNSCrewProvider

# 1. One-call setup
gns = await GNSCrewProvider.create(
    backend_url="https://gns-browser-production.up.railway.app",
    agent_type="autonomous",
    agent_handle="my-crew-agent",
    home_cells=["8a2a1072b59ffff"],
)

# 2. Delegate to human
await gns.delegate("ed25519-human-pk", actions=["search", "code"])

# 3. Create agents with GNS-AIP integration
researcher = Agent(
    role="Researcher",
    goal="Find information about EU AI Act requirements",
    backstory="Expert in AI regulation research",
    tools=[gns.delegation_tool],        # ← delegation check tool
    step_callback=gns.step_callback,     # ← breadcrumb per step
)

# 4. Run crew with task callback
crew = Crew(
    agents=[researcher],
    tasks=[Task(description="Research EU AI Act", agent=researcher)],
    task_callback=gns.task_callback,     # ← breadcrumb per task
)
result = crew.kickoff()
```

## Components

### GNSDelegationTool

CrewAI `BaseTool` subclass — agents can call it mid-task to verify authorization:

```python
from crewai_gns_aip import GNSDelegationTool

tool = GNSDelegationTool(sdk=sdk, agent_id="agent-001")
# Agent calls: gns_check_delegation(action="payment")
# Returns: "✓ Agent authorized at VERIFIED tier. Action 'payment' permitted."
```

### GNSCallbacks

Privacy-preserving breadcrumb factories:

| Callback | Tracks | NEVER Tracks |
|----------|--------|-------------|
| `step_callback` | Tool name, output length, step number | Prompts, tool inputs, outputs |
| `task_callback` | Description length, agent role, task number | Task content, results |

### GNSCrewProvider

All-in-one factory:

```python
gns = await GNSCrewProvider.create(...)

gns.delegation_tool   # → GNSDelegationTool (add to Agent tools)
gns.step_callback     # → function (add to Agent step_callback)
gns.task_callback     # → function (add to Crew task_callback)
gns.agent_id          # → "agent-001"
gns.public_key        # → Ed25519 public key
gns.is_delegated      # → True/False
gns.stats             # → {"steps": 5, "tasks": 1, "errors": 0, "pending": 0}
```

## Architecture

```
┌──────────────────────────────────────────┐
│       Your CrewAI Application             │
│  Agent(tools, step_callback) + Crew(...)  │
├──────────────────────────────────────────┤
│   crewai-gns-aip (this package)           │
│  DelegationTool │ Callbacks │ Provider    │
├──────────────────────────────────────────┤
│        gns-aip (Python SDK)               │
│   provision │ delegate │ breadcrumbs      │
├──────────────────────────────────────────┤
│        GNS Backend (Railway)              │
└──────────────────────────────────────────┘
```

## License

MIT — GNS Foundation
