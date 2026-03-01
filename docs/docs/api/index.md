# API Reference

The GNS-AIP backend exposes REST endpoints for agent provisioning, delegation, manifests, compliance, and breadcrumbs.

**Base URL:** `https://gns-browser-production.up.railway.app`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/provision` | [Provision agent identity](/api/provision) |
| POST | `/agents/delegate` | [Create delegation certificate](/api/delegate) |
| GET | `/agents/:id/manifest` | [Fetch agent manifest](/api/manifest) |
| GET | `/agents/:id/compliance` | [Query compliance score](/api/compliance) |
| POST | `/agents/:id/breadcrumbs` | [Submit breadcrumbs](/api/breadcrumbs) |

## Authentication

All endpoints accept Ed25519-signed requests. The SDKs handle signing automatically.

## Rate Limits

Testnet: 100 requests/minute per agent. Production: configurable per organization.
