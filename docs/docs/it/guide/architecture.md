# Architettura

GNS-AIP è uno stack a quattro livelli. Il codice della tua applicazione parla con i wrapper dei framework, che parlano con gli SDK, che parlano con l'API backend.

```
┌─────────────────────────────────────────────────────────┐
│                  La Tua Applicazione                      │
│         LangChain / OpenAI / Vercel / CrewAI / AutoGen   │
├─────────────────────────────────────────────────────────┤
│              Integrazioni Framework                       │
├─────────────────────────────────────────────────────────┤
│                  SDK per Linguaggio                       │
│         @gns-aip/sdk (TS)  │  gns-aip (Python)           │
├─────────────────────────────────────────────────────────┤
│                  API Backend GNS                          │
│    Railway │ Supabase │ Stellar │ Crittografia Ed25519    │
└─────────────────────────────────────────────────────────┘
```

## Mappa dei Pacchetti

| Pacchetto | Linguaggio | Scopo | Test |
|-----------|-----------|-------|------|
| `@gns-aip/sdk` | TypeScript | SDK Core | 128 |
| `gns-aip` | Python | SDK Core | 37 |
| `langchain-gns-aip` | TypeScript | Callback + tool delega LangChain | 30 |
| `openai-gns-aip` | TypeScript | Hook ciclo di vita OpenAI Agents | 52 |
| `vercel-gns-aip` | TypeScript | Middleware + telemetria Vercel AI | 42 |
| `crewai-gns-aip` | Python | BaseTool + callback CrewAI | 25 |
| `autogen-gns-aip` | Python | register_function + hook AutoGen | 27 |

## Modello di Sicurezza

**Ed25519 ovunque.** Chiavi di identità agente, firme di delega, hash breadcrumb e indirizzi wallet Stellar usano tutti Ed25519.

**Privacy by design.** I breadcrumb non contengono mai prompt, completamenti, input o output degli strumenti. Solo metadati operativi.

**Quantizzazione H3.** Le coordinate GPS raw non vengono mai memorizzate. Le posizioni sono quantizzate in celle esagonali H3.
