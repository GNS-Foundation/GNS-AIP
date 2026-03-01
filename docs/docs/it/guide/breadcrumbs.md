# Breadcrumb

I breadcrumb sono log operativi che preservano la privacy creando una traccia di audit non falsificabile.

## Cosa Viene Registrato

| Registrato | Mai Registrato |
|------------|----------------|
| Timestamp | Prompt |
| Cella H3 | Completamenti |
| Nome strumento | Input strumenti |
| Lunghezza output | Output strumenti |
| Tipo operazione | Dati utente |

Questo è imposto a livello di wrapper del framework. L'API backend non vede mai il contenuto dell'agente.

## Raccolta Automatica

Le integrazioni dei framework raccolgono automaticamente i breadcrumb — non devi chiamare `submitBreadcrumbs` direttamente:

- **LangChain**: `GNSCallbackHandler` registra ogni chiamata LLM e uso strumenti
- **OpenAI**: Hook del ciclo di vita si attivano su `onStart`, `onEnd`, `onToolStart`, `onToolEnd`
- **Vercel AI**: Telemetria middleware registra su ogni `streamText` / `generateText`
- **CrewAI**: `step_callback` e `task_callback` si attivano per step e per task
- **AutoGen**: Hook `register_reply` si attiva per ogni scambio di messaggi

## Epoche

Quando il conteggio dei breadcrumb raggiunge una soglia, il backend crea un'**epoca** — un aggregato firmato che riassume il batch.
