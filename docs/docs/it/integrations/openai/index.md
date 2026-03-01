# Integrazione OpenAI Agents SDK

`openai-gns-aip` aggiunge identità e conformità agli agenti OpenAI tramite hook del ciclo di vita.

```bash
npm install openai-gns-aip @gns-aip/sdk
```

| Componente | Scopo |
|-----------|-------|
| `createGNSHooks` | Hook per `onStart`, `onEnd`, `onToolStart`, ecc. |
| `createDelegationTool` | Tool compatibile OpenAI per verifiche di autorizzazione |
| `GNSOpenAIProvider` | Setup in una chiamata: hook + tool |

52 test che coprono hook, tool, provider e flussi completi del ciclo di vita.
