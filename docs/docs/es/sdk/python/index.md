# SDK Python

`gns-aip` es el SDK core de Python para GNS-AIP. Todas las integraciones Python (CrewAI, AutoGen) se basan en este paquete.

```bash
pip install gns-aip
```

- **GNSAgentSDK** — Cliente async httpx con soporte context manager
- **Modelos Pydantic v2** — ComplianceScore, AgentManifest, DelegationCert, Breadcrumb
- **ComplianceTier** — Enum con operadores de comparación

**Requisitos:** Python >= 3.10, httpx >= 0.25, pydantic >= 2.0. 37 tests.
