# GNS-AIP

**AI Agent Identity Protocol for the Geospatial Naming System.**

Cryptographic identity, territorial jurisdiction, human delegation chains, and compliance scoring for AI agents.

[![CI](https://github.com/GNS-Foundation/GNS-AIP/actions/workflows/ci.yml/badge.svg)](https://github.com/GNS-Foundation/GNS-AIP/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Docs](https://img.shields.io/badge/docs-gns--aip.gcrumbs.com-blue)](https://gns-aip.gcrumbs.com)

---

## The Problem

AI agents are making decisions, accessing data, and taking actions — but nobody can answer basic questions: **Who authorized this agent? What jurisdiction governs it? Is it compliant?**

GNS-AIP answers all three with cryptographic proof, not configuration policy.

## Packages

| Package | Language | Description | Status |
|---------|----------|-------------|--------|
| [`@gns-aip/sdk`](./packages/sdk) | TypeScript | Core SDK — agent identity, delegation, breadcrumbs, compliance | v0.1.0 ✅ |
| [`langchain-gns-aip`](./packages/langchain) | TypeScript | LangChain callback handler + delegation tool | v0.1.0 ✅ |
| [`openai-gns-aip`](./packages/openai) | TypeScript | OpenAI Agents SDK lifecycle hooks | v0.1.0 ✅ |
| [`vercel-gns-aip`](./packages/vercel) | TypeScript | Vercel AI SDK edge-compatible middleware | v0.1.0 ✅ |
| [`gns-aip`](./python/gns-aip) | Python | Async Python SDK with Pydantic v2 models | v0.1.0 ✅ |
| [`crewai-gns-aip`](./python/crewai) | Python | CrewAI BaseTool subclass + step/task callbacks | v0.1.0 ✅ |

**5 framework integrations:** LangChain, OpenAI Agents, Vercel AI, CrewAI, AutoGen (AG2).

## Quick Start

```bash
npm install @gns-aip/sdk
```

```typescript
import {
  generateAgentIdentity,
  createDelegationCert,
  createVirtualBreadcrumb,
  computeComplianceScore
} from '@gns-aip/sdk';

// 1. Create agent identity (Ed25519 keypair)
const agent = generateAgentIdentity();

// 2. Delegate from human principal
const cert = createDelegationCert({
  from: humanKeypair,
  to: agent.publicKey,
  scope: ['read', 'write'],
  territory: ['8428309ffffffff'], // H3 cell (EU jurisdiction)
  ttl: 86400
});

// 3. Collect breadcrumbs during operations
const crumb = createVirtualBreadcrumb({
  agentId: agent.publicKey,
  h3Cell: '8428309ffffffff',
  operationType: 'data_query'
});

// 4. Check compliance
const score = computeComplianceScore(agent);
// → { tier: 'VERIFIED', score: 62, dimensions: { delegation: 25, territory: 18, history: 12, staking: 7 } }
```

## Framework Integrations

Every integration follows three steps: **Install → Provision → Delegate.** Under 5 lines of code change.

### LangChain (TypeScript)

```typescript
import { GnsAipCallbackHandler } from 'langchain-gns-aip';
const handler = new GnsAipCallbackHandler({ agent, delegation: cert });
const chain = new LLMChain({ llm, prompt, callbacks: [handler] });
```

### OpenAI Agents (TypeScript)

```typescript
import { withGnsIdentity } from 'openai-gns-aip';
const secureAgent = withGnsIdentity(agent, { delegation: cert });
```

### CrewAI (Python)

```python
from crewai_gns_aip import GnsIdentityTool, gns_step_callback
crew = Crew(agents=[analyst], tasks=[task], step_callback=gns_step_callback)
```

### AutoGen (Python)

```python
from autogen_gns_aip import register_gns_identity
register_gns_identity(agent, delegation_cert=cert)
```

### Vercel AI (TypeScript)

```typescript
import { gnsComplianceMiddleware } from 'vercel-gns-aip';
const result = await streamText({ model, prompt, middleware: [gnsComplianceMiddleware(agent)] });
```

## Documentation

Full developer documentation in English, Italian, and Spanish:

**[gns-aip.gcrumbs.com](https://gns-aip.gcrumbs.com)**

## Architecture

```
Human Principal ──[delegates]──→ AI Agent ──[operates in]──→ Territory
     │                              │                           │
  Ed25519 key              Ed25519 keypair                  H3 hex cells
  Signs delegation cert    Collects breadcrumbs             Jurisdiction binding
     │                              │                           │
     └──── Delegation Chain ────────┴──── Compliance Score ─────┘
```

**Core concepts:**

- **Identity = Public Key.** Every agent gets an Ed25519 keypair. The public key IS the identity, the signing key, and the Stellar wallet address. No passwords, no API keys.
- **Delegation chains.** Cryptographically-signed chain from human principal → agent → sub-agent. Delegations can only narrow scope — a sub-agent can never exceed its parent's authority.
- **Territorial binding.** H3 hexagonal cells bind agents to geographic jurisdictions. An EU healthcare agent can't operate in US territory without explicit re-authorization.
- **Compliance scoring.** Five-tier model (SHADOW → BASIC → VERIFIED → TRUSTED → SOVEREIGN) scores agents across delegation, territory, history, and staking dimensions. Real-time, auditable.
- **Breadcrumb trail.** Privacy-preserving operation logs. Never records prompts or outputs — only metadata fingerprints.

## Development

```bash
# Clone
git clone git@github.com:GNS-Foundation/GNS-AIP.git
cd GNS-AIP

# Install all workspace dependencies
npm install

# Build all packages
npm run build

# Test (341 assertions across all packages)
npm test
```

## Repository Structure

```
GNS-AIP/
├── packages/
│   ├── sdk/                # @gns-aip/sdk — Core TypeScript SDK
│   │   ├── src/
│   │   │   ├── index.ts    # Public API exports
│   │   │   ├── types.ts    # Type definitions
│   │   │   ├── crypto.ts   # Ed25519 keypairs, signing, Stellar addresses
│   │   │   ├── h3.ts       # H3 territorial binding + jurisdiction
│   │   │   ├── delegation.ts # Delegation certificates
│   │   │   ├── breadcrumb.ts # Virtual breadcrumbs (Proof-of-Jurisdiction)
│   │   │   ├── compliance.ts # TierGate compliance scoring
│   │   │   └── manifest.ts # Agent public identity documents
│   │   ├── dist/           # Compiled JS + type declarations
│   │   ├── test.js         # Integration test suite
│   │   ├── package.json
│   │   └── README.md
│   ├── langchain/          # LangChain integration
│   ├── openai/             # OpenAI Agents integration
│   └── vercel/             # Vercel AI SDK integration
├── python/
│   ├── gns-aip/            # Core Python SDK (async httpx + Pydantic v2)
│   ├── crewai/             # CrewAI integration
│   └── autogen/            # AutoGen / AG2 integration
├── docs/                   # Documentation source (VitePress)
├── .github/
│   └── workflows/
│       ├── ci.yml          # Build + test on push/PR
│       └── publish.yml     # npm publish on version tag
├── package.json            # Workspace root
├── LICENSE                 # Apache-2.0
└── README.md               # This file
```

## Test Coverage

341 assertions across all packages, running in GitHub Actions CI on every push and PR.

```
@gns-aip/sdk          78 assertions — identity, delegation, h3, breadcrumbs, compliance
langchain-gns-aip     52 assertions — callback handler, delegation tool, chain integration
openai-gns-aip        48 assertions — lifecycle hooks, middleware, delegation verification
vercel-gns-aip        41 assertions — edge middleware, streaming compliance headers
gns-aip (Python)      89 assertions — async identity, delegation chains, Pydantic models
crewai-gns-aip        33 assertions — BaseTool, step/task callbacks, crew identity
```

## Roadmap

| Deliverable | Phase | Status |
|-------------|-------|--------|
| Core SDK (TypeScript + Python) | Phase 0 | ✅ Shipped |
| Framework integrations (5 frameworks) | Phase 0 | ✅ Shipped |
| Developer documentation portal | Phase 1 | ✅ Live at gns-aip.gcrumbs.com |
| CI/CD pipeline | Phase 0 | ✅ 341 tests passing |
| Testnet environment on Railway | Phase 1 | 🔜 In progress |
| Testnet GNS token faucet | Phase 1 | 🔜 In progress |
| Agent Handle registry | Phase 1 | 🔜 Planned |
| Compliance Dashboard MVP | Phase 2 | 🔜 Planned |
| Cloudflare Worker verification | Phase 2 | 🔜 Planned |
| Pilot deployments | Phase 2 | 🔜 Planned |
| Rust SDK port | Phase 2 | 🔜 Planned |

## Standards Alignment

- **IETF Internet-Draft:** [draft-ayerbe-trip-protocol-02](https://datatracker.ietf.org/doc/draft-ayerbe-trip-protocol/) (RATS working group engagement)
- **NIST AI RMF (AI 100-1):** Delegation chains → GOVERN 4, territorial scope → MAP 1, trust scoring → MEASURE 2
- **NIST CSF 2.0:** Asset identification (ID.AM), access control (PR.AA), monitoring (DE.CM), attribution (RS.AN)
- **NIST SP 800-53 Rev. 5:** Agent authentication (IA-2, IA-8), least privilege (AC-6), audit content (AU-3)
- **IETF RATS (RFC 9334):** Attester (agent), Verifier (GNS validation), Relying Party (consuming service)
- **EU AI Act:** Article 14 human oversight, Article 13 traceability
- **US Provisional Patent:** 63/948,788 (Proof-of-Trajectory, filed December 26, 2025)

## Related

- [GNS Protocol](https://globecrumbs.com) — The human identity layer (Proof-of-Trajectory)
- [IETF Draft](https://datatracker.ietf.org/doc/draft-ayerbe-trip-protocol/) — TrIP Protocol specification

## License

Apache-2.0 — [GNS Foundation](https://globecrumbs.com) · [ULISSY s.r.l.](https://ulissy.com)
