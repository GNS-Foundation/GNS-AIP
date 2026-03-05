# @gns-aip/cyberark

**GNS-AIP × CyberArk Conjur** — Delegated AI agent identity for Privileged Access Management.

Replace static service accounts with cryptographically verifiable delegation chains.

---

## The Problem with CyberArk's "Secure AI Agents" (Nov 2025)

CyberArk launched AI agent support in November 2025. It works like this:

```
AI Agent → API Key stored in Conjur Vault → Secret retrieved
```

This is better than hardcoded credentials. But it inherits every limitation of the service account model:

| Question | CyberArk Answer | GNS-AIP Answer |
|---|---|---|
| **Which human authorized this agent?** | Unknown | `humanPrincipalPk` on every operation |
| **What territory does this agent operate in?** | Unknown | H3 cells, cryptographically bound |
| **Which regulations govern this agent?** | Unknown | Derived from territory cells |
| **Can I verify the delegation chain?** | No | Ed25519 signatures, fully verifiable |
| **Is there a human in the loop?** | Optional webhook | HITL engine, EU AI Act Art 14 |
| **Can an agent sub-delegate?** | No | Yes, with enforced depth limits |
| **What did this agent do?** | Conjur audit log | Breadcrumb chain (Proof-of-Jurisdiction) |

GNS-AIP doesn't replace Conjur — it **upgrades the identity layer** that authenticates to Conjur.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    GNS-AIP × CyberArk Stack                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Human Principal (GCRUMBS app)                                   │
│       │                                                           │
│       │ signs DelegationCert                                      │
│       │ (territory + facets + TTL + depth)                        │
│       ▼                                                           │
│  AI Agent (Ed25519 keypair)                                       │
│       │                                                           │
│       │ authenticates via GNS cert                                │
│       ▼                                                           │
│  Conjur /authn-gns endpoint  ←── GNS Conjur Authenticator Plugin │
│       │                                                           │
│       │ issues scoped session token                               │
│       ▼                                                           │
│  Conjur Vault                                                     │
│       │                                                           │
│       │ returns secret (SCADA creds, API keys, SSH certs...)      │
│       ▼                                                           │
│  GNS HITL Engine  ←── optional: GCRUMBS app approval push        │
│       │                                                           │
│       │ breadcrumb logged (Proof-of-Jurisdiction)                 │
│       ▼                                                           │
│  Audit Trail (immutable, cryptographically signed)                │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

```bash
npm install @gns-aip/cyberark
```

```typescript
import { createGnsConjurClient } from '@gns-aip/cyberark';
import { generateIdentityKeypair, getH3Cell, buildJurisdiction } from '@gns-aip/sdk';

// Human operator keypair (from GCRUMBS app)
const humanKeypair = generateIdentityKeypair();

// Define operational territory (Rome grid, H3 resolution 7)
const romeCell = getH3Cell(41.9028, 12.4964, 7);
const romeTerritory = buildJurisdiction(romeCell, 2); // 19 cells

// Create GNS-governed Conjur client
const conjur = createGnsConjurClient({
  conjurUrl: 'https://conjur.your-company.com',
  account: 'production',
  humanKeypair,
});

// Provision an AI agent with GNS identity
const agent = await conjur.provisionAgent({
  role: 'scada-monitor',
  territoryCells: romeTerritory,
  facets: ['read', 'telemetry'],
  riskLevel: 'HIGH',
});

// Retrieve a secret — HITL-gated, breadcrumb-audited
const password = await agent.retrieveSecret('grid/rome/scada-password', {
  onEscalation: async (req) => {
    // Push approval request to GCRUMBS mobile app
    await sendPushNotification(req.approvalPayload);
  },
});
```

---

## Integration Modes

### Mode 1: GNS as Conjur Authenticator (Recommended)

Replace API key authentication with GNS delegation cert authentication.

The agent proves its identity by presenting a cert signed by a verified human principal.
No static credentials. No secrets stored. Identity *is* the keypair.

```typescript
// Agent authenticates to Conjur using its GNS delegation cert
// Conjur verifies: Ed25519 signature + territory binding + facet scope + expiry
const agent = await conjur.provisionAgent({ role: 'grid-agent', ... });
const secret = await agent.retrieveSecret('secrets/api-key');
```

### Mode 2: GNS as OIDC IdP (Conjur OIDC Authenticator)

Use Conjur's built-in OIDC authenticator with GNS as the identity provider.

```typescript
import { GnsConjurOidcBridge } from '@gns-aip/cyberark';

// Generate Conjur OIDC authenticator policy
const policy = GnsConjurOidcBridge.generateOidcAuthenticatorPolicy('production');
// Load with: conjur policy load -b root -f policy.yml

// GNS id_token claims → Conjur annotations
const annotations = GnsConjurOidcBridge.mapGnsClaimsToConjurAnnotations(gnsIdToken);
// { 'gns/trust-tier': 'NAVIGATOR', 'gns/humanity-verified': 'true', ... }
```

### Mode 3: Auto-Generate Conjur Policy from Delegation Cert

No manual policy authoring. GNS delegation certs automatically generate correct Conjur YAML.

```typescript
const policy = agent.getConjurPolicy({ hostPrefix: 'agents/gns' });
console.log(policy.yaml);
// ---
// - !host
//   id: agents/gns/7e167eb4b336ba88
//   annotations:
//     gns/cert-id: c3ce9c32...
//     gns/human-principal: bd622aaf...
//     gns/facets: "read,telemetry"
//     gns/territory-count: "19"
// - !layer layers/territory/871e8052affffff
// ...

// Load directly into Conjur
// conjur policy load -b root -f gns-policy-c3ce9c32.yml
```

### Mode 4: Hybrid HITL + Conjur (Critical Infrastructure)

For highest-risk operations (SCADA, financial, medical): GNS HITL gates every secret retrieval.

```typescript
const agent = await conjur.provisionAgent({
  role: 'grid-actuator',
  facets: ['execute'],       // can write to SCADA systems
  riskLevel: 'CRITICAL',    // HITL on every single operation
  territoryCells: romeGrid,
});

const credentials = await agent.retrieveSecret('grid/actuator/auth', {
  onEscalation: async (req) => {
    // Every retrieval requires human approval from GCRUMBS app
    // req.approvalPayload → base64 payload for push notification
    await gcrumbs.requestApproval(req);
  },
  purpose: 'Emergency grid rebalancing — Rome North quadrant',
});
```

---

## EU AI Act Compliance

Every `GnsConjurAgent` automatically satisfies the key EU AI Act articles for high-risk AI systems:

```typescript
const report = agent.getComplianceReport();

// {
//   art13_transparency: true,    // Art 13: audit trail of all operations
//   art14_humanOversight: true,  // Art 14: HITL engine active
//   art17_riskManagement: true,  // Art 17: risk level registered
//   art26_responsibilities: true,// Art 26: human principal identified
//   euAiActCompliant: true,
//   breadcrumbCount: 47,
//   trustScore: 72.4,
//   complianceTier: 'trusted',
// }
```

The audit log is exportable for regulatory inspection:

```typescript
const log = agent.getAuditLog();
// [
//   {
//     timestamp: '2026-03-05T19:42:00Z',
//     agentPk: '7e167eb4...',
//     humanPrincipalPk: 'bd622aaf...',
//     operation: 'RETRIEVE_SECRET',
//     secretPath: 'grid/rome/scada-password',
//     facet: 'read',
//     result: 'SUCCESS',
//     breadcrumbHash: 'a3f8c2d1...',
//     delegationCertId: 'c3ce9c32...',
//   }
// ]
```

---

## Why This Beats CyberArk's Native AI Agent Support

CyberArk's November 2025 "Secure AI Agents" feature gives agents a **vault identity** — essentially a managed service account. That's an improvement over hardcoded credentials. But:

1. **No human accountability chain.** You cannot cryptographically prove which human authorized the agent's access. GNS has `humanPrincipalPk` on every operation, signed by the delegating human's Ed25519 key.

2. **No territorial jurisdiction.** CyberArk doesn't know or care where an agent operates. GNS binds every agent to H3 hexagonal cells — EU agents cannot access US-regulated secrets, and vice versa, enforced cryptographically.

3. **No sub-delegation model.** CyberArk has no concept of a manager agent delegating to worker agents with narrowed permissions. GNS supports `maxSubDelegationDepth` with permission intersection at every hop.

4. **No compliance scoring.** CyberArk gives you audit logs. GNS gives you a TierGate compliance score that maps directly to EU AI Act risk tiers, updated in real time.

5. **Static revocation.** Revoking a CyberArk service account is a manual operation. GNS delegation certs have hard-coded expiry, territory, and facet constraints — they self-limit without requiring central revocation.

GNS-AIP + Conjur = the secrets management infrastructure enterprises already have, upgraded with cryptographic accountability.

---

## Terna S.p.A. Reference Architecture

GNS-AIP was designed with Terna's 1.7M smart meter grid as a reference deployment:

```
Human Operator (Rome Control Center)
    │
    │ DelegationCert: territory=Rome H3 cells, facets=[read,telemetry], TTL=8h
    ▼
Grid Monitor Agent  ─── authenticates to Conjur ─── retrieves SCADA credentials
    │
    ├── Smart Meter Zone A (H3: 871e8052affffff)
    ├── Smart Meter Zone B (H3: 871e8053affffff)
    └── Smart Meter Zone C (H3: 871e8054affffff)
         │
         └── Every credential fetch:
               ✅ Human principal verified
               ✅ Territory binding checked
               ✅ HITL escalation if anomaly detected
               ✅ Breadcrumb logged (Proof-of-Jurisdiction)
               ✅ EU AI Act Art 14 compliant
```

---

## License

Apache 2.0 — [GNS Foundation](https://gns.foundation)
