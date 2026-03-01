# Integración CrewAI

`crewai-gns-aip` agrega identidad y cumplimiento a crews CrewAI mediante BaseTool + callbacks.

```bash
pip install crewai-gns-aip gns-aip
```

| Componente | Propósito |
|-----------|-----------|
| `GNSDelegationTool` | Subclase `BaseTool` — agentes verifican autorización durante tareas |
| `GNSCallbacks` | Factories `step_callback` + `task_callback` para breadcrumbs |
| `GNSCrewProvider` | Setup en una llamada: aprovisionamiento + delegación + herramientas |

25 tests. Los callbacks nunca registran prompts ni contenido de tareas.
