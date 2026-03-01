# Provisioning

Agent provisioning creates a new cryptographic identity on the GNS network.

## Agent Types

| Type | Description | Use Case |
|------|-------------|----------|
| `autonomous` | Operates independently after delegation | Background workers, scheduled tasks |
| `supervised` | Requires human approval for sensitive actions | Healthcare, financial advisory |
| `deterministic` | Fixed behavior, no LLM reasoning | Rule engines, validators |

## Home Cells

Every agent is bound to one or more **H3 hexagonal cells** at provisioning time. These cells define the agent's "home territory" — the jurisdictions where it's authorized to operate by default.

```typescript
const agent = await sdk.provisionAgent({
  agentType: 'autonomous',
  homeCells: [
    '8a2a1072b59ffff', // Rome, Italy
    '8a1f05625cbffff', // Milan, Italy
  ],
});
```

H3 cells use [Uber's H3 indexing system](https://h3geo.org/). Resolution 10 provides ~15m² precision — enough to identify a building, not precise enough to track a person.

## GNS Token Staking

Provisioning requires staking **100 GNS tokens** per agent. This creates an economic cost for Sybil attacks and funds the network. On testnet, staking is simulated.

## What Provisioning Returns

```typescript
interface ProvisionResult {
  agentId: string;      // Unique agent identifier
  pkRoot: string;       // Ed25519 public key (this IS the identity)
  agentHandle?: string; // Human-readable handle (e.g., "my-agent")
}
```

The `pkRoot` serves triple duty: it's the agent's identity, signing key, and Stellar wallet address.
