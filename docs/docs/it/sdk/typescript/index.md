# SDK TypeScript

`@gns-aip/sdk` è l'SDK core TypeScript per GNS-AIP. Tutte le integrazioni TypeScript si basano su questo pacchetto.

## Installazione

```bash
npm install @gns-aip/sdk
```

## Funzionalità

- **GNSAgentSDK** — Client HTTP per tutti gli endpoint backend
- **DelegationChain** — Percorri e verifica catene di delega
- **EscalationPolicy** — Valuta quando escalare alla supervisione umana
- **ComplianceTier** — Enum a 5 livelli con operatori di confronto
- **Tipi TypeScript completi** — AgentManifest, DelegationCert, Breadcrumb, ComplianceScore

128 test su tutti i moduli.
