# Agent Identity

Every GNS-AIP agent has an **Ed25519 keypair**. The public key serves triple duty:

1. **Identity** — uniquely identifies the agent on the GNS network
2. **Signing key** — signs delegation certificates and breadcrumbs
3. **Stellar wallet** — receives and stakes GNS tokens

There are no usernames, passwords, or API keys. The cryptographic key IS the identity.

## Identity = Public Key

This is the core design principle of GNS. When you provision an agent, you get back a `pkRoot` — an Ed25519 public key. That key is the agent's permanent, unforgeable identity.

## Agent Handles

Agents can optionally have human-readable handles (e.g., `research-bot`). These are convenience aliases — the cryptographic key remains the authoritative identity.

## Agent Types

| Type | Autonomy | Use Case |
|------|----------|----------|
| `autonomous` | Full | Background workers, scheduled agents |
| `supervised` | Gated | Healthcare, financial advisory |
| `deterministic` | None | Rule engines, validators |
