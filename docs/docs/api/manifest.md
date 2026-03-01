# GET /agents/:id/manifest

Fetch the public agent manifest. This endpoint is unauthenticated — anyone can verify an agent's identity.

## Response

```json
{
  "agentId": "agent-abc123",
  "agentHandle": "my-agent",
  "homeCells": ["8a2a1072b59ffff"],
  "delegationChain": [
    {
      "certHash": "cert-001",
      "delegatorPk": "ed25519-human-pk",
      "delegatePk": "ed25519-agent-pk",
      "chainDepth": 1,
      "scope": { "actions": ["*"], "resources": ["*"] },
      "territory": ["8a2a1072b59ffff"],
      "issuedAt": "2026-03-01T00:00:00Z",
      "isActive": true
    }
  ]
}
```
