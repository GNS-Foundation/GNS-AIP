# Integrazione CrewAI

`crewai-gns-aip` aggiunge identità e conformità ai crew CrewAI tramite BaseTool + callback.

```bash
pip install crewai-gns-aip gns-aip
```

| Componente | Scopo |
|-----------|-------|
| `GNSDelegationTool` | Sottoclasse `BaseTool` — gli agenti verificano l'autorizzazione durante il task |
| `GNSCallbacks` | Factory `step_callback` + `task_callback` per tracciamento breadcrumb |
| `GNSCrewProvider` | Setup in una chiamata: provisioning + delega + tool + callback |

25 test. Rispetta la privacy: i callback non registrano mai prompt o contenuto dei task.
