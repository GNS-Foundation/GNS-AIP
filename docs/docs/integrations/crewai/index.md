# CrewAI Integration

`crewai-gns-aip` adds identity and compliance to CrewAI crews via BaseTool + callbacks.

## Install

```bash
pip install crewai-gns-aip gns-aip
```

## Components

| Component | Purpose |
|-----------|---------|
| `GNSDelegationTool` | `BaseTool` subclass — agents check authorization mid-task |
| `GNSCallbacks` | `step_callback` + `task_callback` factories for breadcrumb tracking |
| `GNSCrewProvider` | One-call setup: provision + delegate + tool + callbacks |

## Quick Start

```python
from crewai import Agent, Task, Crew
from crewai_gns_aip import GNSCrewProvider

gns = await GNSCrewProvider.create(
    backend_url="https://gns-browser-production.up.railway.app",
    agent_type="autonomous",
    agent_handle="research-crew",
    home_cells=["8a2a1072b59ffff"],
)
await gns.delegate("ed25519-human-pk", actions=["search", "code"])

researcher = Agent(
    role="Researcher",
    goal="Research EU AI Act requirements",
    tools=[gns.delegation_tool],
    step_callback=gns.step_callback,
)

crew = Crew(
    agents=[researcher],
    tasks=[Task(description="Research EU AI Act", agent=researcher)],
    task_callback=gns.task_callback,
)
result = crew.kickoff()
```

25 tests. Privacy-preserving: callbacks never log prompts or task content, only metadata.
