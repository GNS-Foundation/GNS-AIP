# What is GNS-AIP?

**GNS-AIP** (Agent Identity Protocol) is a cryptographic identity layer for AI agents. It solves a fundamental problem: AI agents operate without provable identity, human authorization, or jurisdictional compliance.

## The Identity Gap

Every AI agent framework — LangChain, OpenAI, CrewAI, AutoGen, Vercel AI — lets you build agents that reason, use tools, and take actions. None of them answer:

- **Who authorized this agent?** There's no cryptographic link from agent to human principal.
- **Where can it operate?** Agents have no concept of geographic jurisdiction.
- **Is it compliant?** No real-time score, no audit trail, no regulatory reporting.

GNS-AIP fills this gap with four primitives:

## Core Primitives

### 1. Agent Identity

Every agent gets an **Ed25519 keypair**. The public key IS the identity — no usernames, no passwords, no API keys. The same key signs operations, verifies delegation, and identifies the agent on the GNS network.

### 2. Delegation Certificates

A **DelegationCert** is a cryptographically-signed certificate that links an agent to its human principal. Delegation chains can be walked: Agent → Deployer → Human. Every action traces back to a real, accountable person.

### 3. Territorial Binding

Agents are bound to **H3 hexagonal cells** — a hierarchical geospatial grid that maps to real jurisdictions. An agent provisioned with EU cells can't operate in US territory without explicit authorization. This is how "Proof-of-Jurisdiction" works.

### 4. Compliance Scoring

A **5-tier model** (SHADOW → BASIC → VERIFIED → TRUSTED → SOVEREIGN) scores agents across delegation validity, territorial consistency, operational history, and GNS token staking. Scores are computed in real-time and fully auditable.

## Three-Layer Provenance

GNS-AIP distinguishes three roles in the AI supply chain:

| Layer | Role | Example | GNS-AIP Artifact |
|-------|------|---------|-------------------|
| **Layer 1** | Creator | Anthropic, OpenAI | Model origin hash |
| **Layer 2** | Deployer | Your company | AgentManifest |
| **Layer 3** | Principal | Human user | DelegationCert |

**The key insight:** Don't sell to Layer 1 (model builders). Sell to Layer 2 (deployers). Deployers have compliance deadlines, audit requirements, and liability exposure.

## Why Not Biometrics?

WorldCoin scans your iris. GNS-AIP tracks your trajectory.

**You are not your iris. You are your trajectory.**

Biometric identity requires physical scanning, creates honeypot databases, and can be replicated with deepfakes. Proof-of-Trajectory uses the fact that only real humans generate consistent movement patterns over time — patterns that are cryptographically signed at the location where they occur.

## Next Steps

- **[Quick Start](/guide/quickstart)** — Provision your first agent in 2 minutes
- **[Architecture](/guide/architecture)** — How the system fits together
- **[Choose your framework](/integrations/langchain/)** — LangChain, OpenAI, Vercel AI, CrewAI, or AutoGen
