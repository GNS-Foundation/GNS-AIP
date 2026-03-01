# POST /agents/:id/breadcrumbs

Submit privacy-preserving operation breadcrumbs.

## Request

```json
{
  "breadcrumbs": [
    {
      "h3Cell": "8a2a1072b59ffff",
      "operationType": "llm_call",
      "operationHash": "sha256-of-metadata",
      "timestamp": "2026-03-01T12:00:00Z",
      "metadata": {
        "model": "gpt-4",
        "outputLength": 1523
      }
    }
  ]
}
```

::: warning Privacy
Breadcrumbs must NEVER contain prompts, completions, tool inputs, or tool outputs. Only operation metadata. The SDK framework wrappers enforce this automatically.
:::

## Response

```json
{
  "accepted": 5,
  "rejected": 0,
  "epochCreated": false
}
```

When `epochCreated` is `true`, the accepted breadcrumbs triggered a new epoch — a signed aggregate that contributes to the agent's history score.
