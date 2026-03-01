# GET /agents/:id/compliance

Query the real-time compliance score for an agent.

## Response

```json
{
  "total": 85,
  "tier": "VERIFIED",
  "delegation": 25,
  "territory": 20,
  "history": 20,
  "staking": 20,
  "delegationValid": true
}
```

| Field | Range | Description |
|-------|-------|-------------|
| total | 0-100 | Aggregate compliance score |
| tier | enum | SHADOW, BASIC, VERIFIED, TRUSTED, SOVEREIGN |
| delegation | 0-25 | Delegation chain validity |
| territory | 0-25 | Territorial consistency |
| history | 0-25 | Operational history depth |
| staking | 0-25 | GNS token staking level |
| delegationValid | bool | Whether chain reaches human root |
