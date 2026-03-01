# SDK Python

`gns-aip` è l'SDK core Python per GNS-AIP. Tutte le integrazioni Python (CrewAI, AutoGen) si basano su questo pacchetto.

## Installazione

```bash
pip install gns-aip
```

## Funzionalità

- **GNSAgentSDK** — Client async httpx con supporto context manager
- **Modelli Pydantic v2** — ComplianceScore, AgentManifest, DelegationCert, Breadcrumb
- **ComplianceTier** — Enum con operatori di confronto (`<`, `>=`, ecc.)
- **DelegationChain** — Percorri e verifica catene di delega
- **EscalationPolicy** — Valuta quando escalare

**Requisiti:** Python >= 3.10, httpx >= 0.25, pydantic >= 2.0. 37 test superati.
