# Integrazione LangChain

`langchain-gns-aip` aggiunge identità, delega e conformità a qualsiasi agente LangChain.

```bash
npm install langchain-gns-aip @gns-aip/sdk
```

| Componente | Scopo |
|-----------|-------|
| `GNSCallbackHandler` | Raccoglie automaticamente breadcrumb su ogni chiamata LLM e uso strumenti |
| `GNSDelegationTool` | L'agente verifica la propria autorizzazione durante la conversazione |
| `GNSComplianceRunnable` | Avvolge qualsiasi Runnable con middleware di conformità |
| `GNSLangChainProvider` | Setup in una chiamata che crea tutti i componenti |

**Privacy:** Il callback handler non registra **mai** prompt, completamenti o argomenti degli strumenti. 30 test.
