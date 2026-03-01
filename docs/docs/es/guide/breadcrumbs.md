# Breadcrumbs

Los breadcrumbs son registros operativos que preservan la privacidad creando un rastro de auditoría infalsificable.

## Qué Se Registra

| Registrado | Nunca Registrado |
|------------|------------------|
| Timestamp | Prompts |
| Celda H3 | Completaciones |
| Nombre herramienta | Entradas herramientas |
| Longitud output | Salidas herramientas |
| Tipo operación | Datos de usuario |

## Recolección Automática

Las integraciones de frameworks recolectan breadcrumbs automáticamente:

- **LangChain**: `GNSCallbackHandler` registra cada llamada LLM y uso de herramientas
- **OpenAI**: Hooks de ciclo de vida en `onStart`, `onEnd`, `onToolStart`, `onToolEnd`
- **Vercel AI**: Telemetría middleware registra en cada `streamText` / `generateText`
- **CrewAI**: `step_callback` y `task_callback` por paso y por tarea
- **AutoGen**: Hook `register_reply` por cada intercambio de mensajes

## Épocas

Cuando el conteo de breadcrumbs alcanza un umbral, el backend crea una **época** — un agregado firmado que resume el lote.
