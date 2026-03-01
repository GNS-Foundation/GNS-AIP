# POST /agents/provision

Create a new agent identity on the GNS network.

## Request

```json
{
  "agentType": "autonomous",
  "agentHandle": "my-agent",
  "homeCells": ["8a2a1072b59ffff"],
  "stellarAddress": "GABCD...",
  "gnsStaked": 100,
  "jurisdiction": "EU"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| agentType | string | yes | `autonomous`, `supervised`, or `deterministic` |
| agentHandle | string | no | Human-readable handle |
| homeCells | string[] | no | H3 cell IDs for territorial binding |
| stellarAddress | string | no | Stellar wallet address |
| gnsStaked | number | no | GNS tokens staked |
| jurisdiction | string | no | Jurisdiction label |

## Response

```json
{
  "agentId": "agent-abc123",
  "pkRoot": "ed25519-public-key-hex",
  "agentHandle": "my-agent"
}
```
