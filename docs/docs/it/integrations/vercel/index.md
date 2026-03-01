# Integrazione Vercel AI SDK

`vercel-gns-aip` aggiunge header di conformità e telemetria alle risposte Vercel AI SDK.

```bash
npm install vercel-gns-aip @gns-aip/sdk
```

| Componente | Scopo |
|-----------|-------|
| `createGNSMiddleware` | Middleware con `wrapGenerate` e `wrapStream` |
| `createGNSTelemetry` | Config telemetria per `experimental_telemetry` |
| `GNSVercelProvider` | Setup in una chiamata per middleware + telemetria |

Compatibile con Edge (funziona in Cloudflare Workers, Vercel Edge Functions). 42 test.
