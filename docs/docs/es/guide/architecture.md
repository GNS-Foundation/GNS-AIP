# Arquitectura

GNS-AIP es un stack de cuatro capas. El código de tu aplicación habla con los wrappers de frameworks, que hablan con los SDKs, que hablan con la API backend.

```
┌─────────────────────────────────────────────────────────┐
│                  Tu Aplicación                            │
│         LangChain / OpenAI / Vercel / CrewAI / AutoGen   │
├─────────────────────────────────────────────────────────┤
│              Integraciones de Frameworks                  │
├─────────────────────────────────────────────────────────┤
│                  SDKs por Lenguaje                        │
│         @gns-aip/sdk (TS)  │  gns-aip (Python)           │
├─────────────────────────────────────────────────────────┤
│                  API Backend GNS                          │
│    Railway │ Supabase │ Stellar │ Criptografía Ed25519    │
└─────────────────────────────────────────────────────────┘
```

## Mapa de Paquetes

| Paquete | Lenguaje | Propósito | Tests |
|---------|----------|-----------|-------|
| `@gns-aip/sdk` | TypeScript | SDK Core | 128 |
| `gns-aip` | Python | SDK Core | 37 |
| `langchain-gns-aip` | TypeScript | Callback + herramienta delegación | 30 |
| `openai-gns-aip` | TypeScript | Hooks ciclo de vida OpenAI | 52 |
| `vercel-gns-aip` | TypeScript | Middleware + telemetría Vercel | 42 |
| `crewai-gns-aip` | Python | BaseTool + callbacks CrewAI | 25 |
| `autogen-gns-aip` | Python | register_function + hooks AutoGen | 27 |

## Modelo de Seguridad

**Ed25519 en todas partes.** Claves de identidad, firmas de delegación, hashes de breadcrumb y direcciones de wallet Stellar.

**Privacidad por diseño.** Los breadcrumbs nunca contienen prompts, completaciones, entradas o salidas de herramientas.

**Cuantización H3.** Las coordenadas GPS raw nunca se almacenan.
