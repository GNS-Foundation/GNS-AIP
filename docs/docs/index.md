---
layout: home

hero:
  name: GNS-AIP
  text: Agent Identity Protocol
  tagline: Give your AI agents provable identity, human delegation, and compliance scoring. 5 lines of code. Any framework.
  actions:
    - theme: brand
      text: Quick Start →
      link: /guide/quickstart
    - theme: alt
      text: View on GitHub
      link: https://github.com/GNS-Foundation/GNS-AIP

features:
  - icon: ID
    title: Agent Identity
    details: Every AI agent gets an Ed25519 keypair and cryptographic identity. No passwords, no API keys — the public key IS the identity.
  - icon: DC
    title: Human Delegation
    details: Delegation certificates create a cryptographically-signed chain from human principal to AI agent. Every action traces back to a real person.
  - icon: H3
    title: Territorial Binding
    details: H3 hexagonal cells bind agents to geographic jurisdictions. An EU healthcare agent can't operate in US territory without explicit authorization.
  - icon: CS
    title: Compliance Scoring
    details: Five-tier compliance model (SHADOW → SOVEREIGN) scores agents across delegation, territory, history, and staking. Real-time, auditable.
  - icon: BC
    title: Breadcrumb Trail
    details: Privacy-preserving operation logs create an unfakeable audit trail. Never records prompts or outputs — only metadata fingerprints.
  - icon: FW
    title: Any Framework, 5 Lines
    details: Drop-in integrations for LangChain, OpenAI, Vercel AI, CrewAI, and AutoGen. Provision → Delegate → Go. Under 5 lines of code change.
---

<style>
.framework-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  margin: 32px 0;
}
.framework-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 24px;
  transition: border-color 0.25s, transform 0.25s;
}
.framework-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}
.framework-card h3 {
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.framework-card .lang {
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
}
.lang-ts { background: #3178C6; color: white; }
.lang-py { background: #3776AB; color: white; }
.framework-card p { margin: 0; color: var(--vp-c-text-2); font-size: 0.9rem; }
.framework-card code { font-size: 0.8rem; }

.stats-bar {
  display: flex;
  justify-content: center;
  gap: 48px;
  margin: 48px 0;
  flex-wrap: wrap;
}
.stat {
  text-align: center;
}
.stat .number {
  font-size: 2.5rem;
  font-weight: 800;
  line-height: 1.3;
  padding-top: 4px;
  background: linear-gradient(135deg, #00D4AA, #0EA5E9);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.stat .label {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin-top: 4px;
}
</style>

## By the Numbers

<div class="stats-bar">
  <div class="stat">
    <div class="number">6</div>
    <div class="label">SDK Packages</div>
  </div>
  <div class="stat">
    <div class="number">341</div>
    <div class="label">Tests Passing</div>
  </div>
  <div class="stat">
    <div class="number">5</div>
    <div class="label">Frameworks</div>
  </div>
  <div class="stat">
    <div class="number">2</div>
    <div class="label">Languages</div>
  </div>
</div>

## Framework Integrations

<div class="framework-grid">

<div class="framework-card">

### LangChain <span class="lang lang-ts">TS</span>

`langchain-gns-aip`

Callback handler + delegation tool for any LangChain agent. Auto-collects breadcrumbs on every LLM call, tool use, and chain step.

[Get Started →](/integrations/langchain/)

</div>

<div class="framework-card">

### OpenAI Agents <span class="lang lang-ts">TS</span>

`openai-gns-aip`

Lifecycle hooks for OpenAI Agents SDK. Wraps any agent with identity provisioning, delegation verification, and compliance middleware.

[Get Started →](/integrations/openai/)

</div>

<div class="framework-card">

### Vercel AI <span class="lang lang-ts">TS</span>

`vercel-gns-aip`

Edge-compatible middleware for Vercel AI SDK. Adds compliance headers to every `streamText` / `generateText` response.

[Get Started →](/integrations/vercel/)

</div>

<div class="framework-card">

### CrewAI <span class="lang lang-py">PY</span>

`crewai-gns-aip`

BaseTool subclass + step/task callbacks. Every crew member gets verified identity. Manager delegates to the crew.

[Get Started →](/integrations/crewai/)

</div>

<div class="framework-card">

### AutoGen / AG2 <span class="lang lang-py">PY</span>

`autogen-gns-aip`

`register_function` tool + `register_reply` hooks + message hooks. One call wires identity into any ConversableAgent conversation.

[Get Started →](/integrations/autogen/)

</div>

<div class="framework-card">

### Python SDK <span class="lang lang-py">PY</span>

`gns-aip`

Async httpx client with Pydantic v2 models. Foundation for all Python integrations. DelegationChain + EscalationPolicy utilities built in.

[Get Started →](/sdk/python/)

</div>

</div>

## The Problem

AI agents are making decisions, accessing data, and taking actions — but nobody can answer basic questions: **Who authorized this agent? What jurisdiction governs it? Is it compliant?**

The EU AI Act (Article 14) requires human oversight of AI systems. GDPR Article 22 demands accountability for automated decisions. FINMA requires audit trails for AI-assisted financial advice. Every regulation points to the same gap: **AI agents have no identity.**

## The Solution

GNS-AIP gives every AI agent a cryptographic identity that traces back to a human principal through delegation certificates. Agents are bound to geographic jurisdictions via H3 hexagonal cells. Every operation produces a privacy-preserving breadcrumb. Compliance scores are computed in real-time across five tiers.

```
Human Principal ──[delegates]──→ AI Agent ──[operates in]──→ Territory
     │                              │                           │
  Ed25519 key              Ed25519 keypair                  H3 hex cells
  Signs delegation cert    Collects breadcrumbs             Jurisdiction binding
     │                              │                           │
     └──── Delegation Chain ────────┴──── Compliance Score ─────┘
```

**You are not your iris. You are your trajectory.**
