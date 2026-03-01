# Integración OpenAI Agents SDK

`openai-gns-aip` agrega identidad y cumplimiento a agentes OpenAI mediante hooks de ciclo de vida.

```bash
npm install openai-gns-aip @gns-aip/sdk
```

| Componente | Propósito |
|-----------|-----------|
| `createGNSHooks` | Hooks para `onStart`, `onEnd`, `onToolStart`, etc. |
| `createDelegationTool` | Herramienta compatible OpenAI para verificaciones |
| `GNSOpenAIProvider` | Setup en una llamada: hooks + herramienta |

52 tests cubriendo hooks, herramientas, provider y flujos completos.
