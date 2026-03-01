# Architecture

GNS-AIP is a four-layer stack. Your application code talks to framework wrappers, which talk to language SDKs, which talk to the backend API.

```
┌─────────────────────────────────────────────────────────┐
│                  Your Application                        │
│         LangChain / OpenAI / Vercel / CrewAI / AutoGen   │
├─────────────────────────────────────────────────────────┤
│              Framework Integrations                       │
│  langchain-gns-aip │ openai-gns-aip │ crewai-gns-aip    │
│  vercel-gns-aip    │ autogen-gns-aip                     │
├─────────────────────────────────────────────────────────┤
│                  Language SDKs                            │
│         @gns-aip/sdk (TS)  │  gns-aip (Python)           │
├─────────────────────────────────────────────────────────┤
│                  GNS Backend API                          │
│    Railway │ Supabase │ Stellar │ Ed25519 Crypto          │
├─────────────────────────────────────────────────────────┤
│                  GNS Protocol                             │
│   Breadcrumb Chain │ H3 Grid │ Delegation Graph │ Token   │
└─────────────────────────────────────────────────────────┘
```

## Package Map

| Package | Language | Purpose | Tests |
|---------|----------|---------|-------|
| `@gns-aip/sdk` | TypeScript | Core SDK — types, client, utilities | 128 |
| `gns-aip` | Python | Core SDK — Pydantic models, async client | 37 |
| `langchain-gns-aip` | TypeScript | LangChain callback + delegation tool | 30 |
| `openai-gns-aip` | TypeScript | OpenAI Agents SDK lifecycle hooks | 52 |
| `vercel-gns-aip` | TypeScript | Vercel AI middleware + telemetry | 42 |
| `crewai-gns-aip` | Python | CrewAI BaseTool + step/task callbacks | 25 |
| `autogen-gns-aip` | Python | AutoGen register_function + reply hooks | 27 |

## Data Flow

### Provisioning

```
Developer calls sdk.provisionAgent()
        │
        ▼
POST /agents/provision
        │
        ├─→ Generate Ed25519 keypair
        ├─→ Create agent record in Supabase
        ├─→ Register H3 home cells
        └─→ Return { agentId, pkRoot, agentHandle }
```

### Delegation

```
Human signs delegation
        │
        ▼
POST /agents/delegate
        │
        ├─→ Verify principal's Ed25519 signature
        ├─→ Create DelegationCert
        ├─→ Store cert in delegation_certs table
        └─→ Return { certHash, chainDepth, scope }
```

### Breadcrumb Collection

```
Agent performs operation
        │
        ▼
Framework wrapper captures metadata (NEVER content)
        │
        ▼
POST /agents/:id/breadcrumbs
        │
        ├─→ Validate H3 cells
        ├─→ Hash operation metadata
        ├─→ Append to breadcrumb chain
        └─→ Create epoch if threshold reached
```

### Compliance Scoring

```
GET /agents/:id/compliance
        │
        ├─→ Check delegation chain validity  (0-25 pts)
        ├─→ Check territorial consistency    (0-25 pts)
        ├─→ Check operational history depth  (0-25 pts)
        ├─→ Check GNS token staking level    (0-25 pts)
        │
        ▼
ComplianceScore { total: 85, tier: VERIFIED }
```

## Backend Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| API Server | Node.js / Hono | REST endpoints, Ed25519 verification |
| Database | Supabase (PostgreSQL) | Agents, delegation certs, breadcrumbs, compliance |
| Hosting | Railway | Auto-deploy from GitHub, HTTPS, scaling |
| Blockchain | Stellar | GNS token operations, staking, wallet creation |
| DNS / Email | Cloudflare | Domain routing, email bridge |
| Location | H3 (Uber) | Hexagonal geospatial indexing |

## Security Model

**Ed25519 everywhere.** Agent identity keys, delegation signatures, breadcrumb hashes, and Stellar wallet addresses all use Ed25519. A single keypair serves as identity, signing key, and wallet address.

**Privacy by design.** Breadcrumbs never contain prompts, completions, tool inputs, or tool outputs. Only operation metadata: timing, tool names, output lengths, H3 cells. This is enforced at the framework wrapper level — the backend never sees agent content.

**H3 quantization.** Raw GPS coordinates are never stored. Locations are quantized to H3 hexagonal cells at resolution 10 (~15m²), providing useful geospatial data without precise location tracking.
