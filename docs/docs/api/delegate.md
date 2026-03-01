# POST /agents/delegate

Create a delegation certificate linking an agent to a human principal.

## Request

```json
{
  "principalPk": "ed25519-human-public-key",
  "agentId": "agent-abc123",
  "scope": {
    "actions": ["search", "code"],
    "resources": ["*"]
  },
  "territory": ["8a2a1072b59ffff"],
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

## Response

```json
{
  "certHash": "cert-hash-hex",
  "delegatorPk": "ed25519-human-pk",
  "delegatePk": "ed25519-agent-pk",
  "chainDepth": 1,
  "scope": { "actions": ["search", "code"], "resources": ["*"] },
  "territory": ["8a2a1072b59ffff"],
  "issuedAt": "2026-03-01T00:00:00Z",
  "expiresAt": "2026-12-31T23:59:59Z",
  "isActive": true
}
```
