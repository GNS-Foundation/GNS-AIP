# GNS-AIP

**AI Agent Identity Protocol for the Geospatial Naming System.**

Cryptographic identity, territorial jurisdiction, human delegation chains, and compliance scoring for AI agents.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`@gns-aip/sdk`](./packages/sdk) | Core SDK — agent identity, delegation, breadcrumbs, compliance | v0.1.0 |

## Quick Start

```bash
# Install
npm install @gns-aip/sdk

# Use
import { generateAgentIdentity, createDelegationCert, createVirtualBreadcrumb } from '@gns-aip/sdk';
```

See [`packages/sdk/README.md`](./packages/sdk/README.md) for full documentation.

## Development

```bash
# Clone
git clone git@github.com:GNS-Foundation/GNS-AIP.git
cd GNS-AIP

# Install all workspace dependencies
npm install

# Build all packages
npm run build

# Test
node packages/sdk/test.js
```

## Repository Structure

```
GNS-AIP/
├── packages/
│   └── sdk/                # @gns-aip/sdk — Core TypeScript SDK
│       ├── src/
│       │   ├── index.ts    # Public API exports
│       │   ├── types.ts    # Type definitions (the contract)
│       │   ├── crypto.ts   # Ed25519 keypairs, signing, Stellar addresses
│       │   ├── h3.ts       # H3 territorial binding + jurisdiction
│       │   ├── delegation.ts # Delegation certificates
│       │   ├── breadcrumb.ts # Virtual breadcrumbs (Proof-of-Jurisdiction)
│       │   ├── compliance.ts # TierGate compliance scoring
│       │   └── manifest.ts # Agent public identity documents
│       ├── dist/           # Compiled JS + type declarations
│       ├── test.js         # Integration test suite (78 assertions)
│       ├── package.json    # npm package config
│       └── README.md       # SDK documentation
├── .github/
│   └── workflows/
│       ├── ci.yml          # Build + test on push/PR
│       └── publish.yml     # npm publish on version tag
├── package.json            # Workspace root
├── LICENSE                 # Apache-2.0
└── README.md               # This file
```

## Roadmap

The GNS-AIP monorepo will expand as the execution plan progresses:

```
packages/
├── sdk/                    # ✅ Core SDK (this release)
├── langchain/              # 🔜 LangChain integration (Phase 1)
├── crewai/                 # 🔜 CrewAI integration (Phase 1)
├── dashboard/              # 🔜 Compliance Dashboard (Phase 2)
├── cloudflare-worker/      # 🔜 CF Worker verification (Phase 2)
└── sdk-rust/               # 🔜 Rust SDK port (Phase 2)
```

## License

Apache-2.0 — GNS Foundation
