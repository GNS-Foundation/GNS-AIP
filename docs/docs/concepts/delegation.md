# Delegation Chains

A delegation chain is a sequence of cryptographically-signed certificates that links an AI agent back to a human principal.

## Chain Structure

```
Human Principal ──[cert 1]──> Deployer Agent ──[cert 2]──> Worker Agent
     depth: 0                    depth: 1                    depth: 2
```

Every chain must terminate at a human root. Chains without a human root are invalid — the agent operates at SHADOW tier.

## Certificate Fields

Each DelegationCert contains: delegator public key, delegate public key, action scope, resource scope, territory binding, issuance time, and optional expiration.

## Verification

`DelegationChain.verify()` walks the chain from agent to root, checking that every certificate is valid, not expired, and that the root is a human identity (not another agent).

## Scope Narrowing

Each delegation can only narrow scope, never widen it. If a human delegates `["search", "code"]` to Agent A, Agent A cannot delegate `["search", "code", "payment"]` to Agent B.
