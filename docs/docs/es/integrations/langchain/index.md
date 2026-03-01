# Integración LangChain

`langchain-gns-aip` agrega identidad, delegación y cumplimiento a cualquier agente LangChain.

```bash
npm install langchain-gns-aip @gns-aip/sdk
```

| Componente | Propósito |
|-----------|-----------|
| `GNSCallbackHandler` | Recolecta automáticamente breadcrumbs en cada llamada LLM |
| `GNSDelegationTool` | El agente verifica su autorización durante la conversación |
| `GNSComplianceRunnable` | Envuelve cualquier Runnable con middleware de cumplimiento |
| `GNSLangChainProvider` | Setup en una llamada que crea todos los componentes |

**Privacidad:** El callback handler **nunca** registra prompts, completaciones o argumentos. 30 tests.
