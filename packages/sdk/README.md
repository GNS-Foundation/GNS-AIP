# @gns-aip/sdk

**Cryptographic identity, delegation chains, and audit trails for AI agents.**

Add EU AI Act compliance to your AI agents in 10 minutes. No infrastructure changes. Works with LangChain, CrewAI, OpenAI, Vercel AI SDK, or any framework.

## Why

The EU AI Act (Art. 12 + Art. 14, enforcement August 2, 2026) requires that every high-risk AI system produce an auditable record of what it did, when, and under whose authority — traceable to a natural person. Service accounts and CloudTrail logs don't satisfy this. `@gns-aip/sdk` does.

Every agent gets an Ed25519 identity. Every action drops a signed, SHA-256 chained breadcrumb. Every breadcrumb links back to a human principal through a delegation certificate. The chain is independently verifiable — no cloud credentials needed.

## Install

```bash
npm install @gns-aip/sdk
```

Requires Node.js ≥ 18. Zero native dependencies.

## Quick start — 10 minutes to compliance

```typescript
import {
  generateAgentIdentity,
  createDelegationCert,
  createJurisdictionFromCenter,
  createVirtualBreadcrumb,
  calculateComplianceScore,
  determineTier,
} from '@gns-aip/sdk';

// 1. Create identities
const human = generateAgentIdentity();  // human principal
const agent = generateAgentIdentity();  // AI agent

// 2. Bind to a jurisdiction (H3 territory around Rome)
const jurisdiction = createJurisdictionFromCenter(
  41.8902, 12.4922, 5, 1, 'GDPR', 'eu'
);

// 3. Human delegates authority to agent
const cert = await createDelegationCert({
  deployerIdentity: human.publicKey,
  principalIdentity: human.publicKey,
  agentIdentity: agent.publicKey,
  territoryCells: jurisdiction.cells,
  facetPermissions: ['infrastructure', 'energy'],
}, human.secretKey);

// 4. Agent drops audit breadcrumbs (every action → one block)
const breadcrumb = await createVirtualBreadcrumb({
  agentIdentity: agent.publicKey,
  operationCell: jurisdiction.cells[0],
  meta: {
    operationType: 'inference',
    delegationCertHash: cert.certHash,
    facet: 'energy',
    withinTerritory: true,
  },
}, agent.secretKey, null); // null = genesis block

// 5. Compliance tier computed from operational history
const score = calculateComplianceScore({
  breadcrumbCount: 150, chainAge: 30,
  violationCount: 0, uniqueCells: 5, delegationDepth: 1,
});
determineTier(score); // → 'observed' (50+) → 'trusted' (500+) → 'certified' (5000+)
```

## What you get

| Feature | Description |
|---------|-------------|
| **Ed25519 identity** | Every agent gets a cryptographic keypair. Public key doubles as Stellar wallet address. |
| **Delegation certificates** | Human → agent authorization with territorial scope (H3), facet permissions, time window, sub-delegation depth. |
| **Virtual breadcrumbs** | SHA-256 chained, Ed25519 signed audit trail. Every action = one block in an append-only chain. |
| **Jurisdiction binding** | H3 hexagonal cells define authorized territory. Pre-flight checks enforce boundaries. |
| **Compliance scoring** | 5-tier trust: Provisioned → Observed → Trusted → Certified → Sovereign. |
| **Sub-delegation chains** | Agent A → Agent B with narrowed scope. Full chain verifiable back to human principal. |
| **MCP middleware** | Server-side compliance gating for Model Context Protocol servers. |
| **Human-in-the-Loop** | Escalation policies triggering human review based on risk, territory, or tier. |

## Framework integrations

| Package | Framework | Install |
|---------|-----------|---------|
| `langchain-gns-aip` | LangChain | `npm install langchain-gns-aip` |
| `openai-gns-aip` | OpenAI Agents | `npm install openai-gns-aip` |
| `gns-aip` | Python (async) | `pip install gns-aip` |
| `crewai-gns-aip` | CrewAI | `pip install crewai-gns-aip` |

## EU AI Act compliance mapping

| Article | Requirement | SDK implementation |
|---|---|---|
| Art. 12 — Record-keeping | Automatic event logging traceable to human | VirtualBreadcrumb chain + delegation cert hash |
| Art. 14 — Human oversight | Natural person must oversee AI actions | DelegationCert binds agent to human principal |
| Art. 14(4)(d) — Override | Human can stop or disregard AI system | Cert expiry + revocation + scope constraints |
| Art. 26 — Deployer obligations | Assign qualified oversight personnel | DelegationCert.principalIdentity = specific human |

## API reference

### Crypto
- `generateAgentIdentity()` → Ed25519 keypair
- `sign(message, secretKey)` → hex signature
- `verify(message, signature, publicKey)` → boolean
- `ed25519ToStellarAddress(publicKey)` → Stellar G... address

### Delegation
- `createDelegationCert(input, secretKey)` → signed DelegationCert
- `verifyDelegationCert(cert)` → boolean
- `validateDelegation(cert, cell, facet)` → validation result

### Breadcrumbs
- `createVirtualBreadcrumb(input, secretKey, prevHash)` → VirtualBreadcrumb
- `verifyBreadcrumb(breadcrumb)` → boolean
- `verifyBreadcrumbChain(breadcrumbs)` → chain verification result

### Compliance
- `calculateComplianceScore(stats)` → 0-100 score
- `determineTier(score)` → tier string

### Sub-delegation
- `createSubDelegation(parentCert, childPK, scope, parentSK)` → narrowed cert
- `verifyDelegationChain(chain)` → chain verification
- `getRootPrincipal(chain)` → human public key

## Full runtime

For geospatial AI agents with satellite perception, jurisdiction enforcement, and infrastructure addressing, see [GEIANT](https://geiant.com).

## License

Apache-2.0 — [GNS Foundation](https://github.com/GNS-Foundation)
