# Integración Vercel AI SDK

`vercel-gns-aip` agrega headers de cumplimiento y telemetría a respuestas Vercel AI SDK.

```bash
npm install vercel-gns-aip @gns-aip/sdk
```

| Componente | Propósito |
|-----------|-----------|
| `createGNSMiddleware` | Middleware con `wrapGenerate` y `wrapStream` |
| `createGNSTelemetry` | Config telemetría para `experimental_telemetry` |
| `GNSVercelProvider` | Setup en una llamada |

Compatible con Edge (Cloudflare Workers, Vercel Edge Functions). 42 tests.
