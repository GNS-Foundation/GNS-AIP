# Compliance Scoring

GNS-AIP uses a 5-tier compliance model that scores agents in real-time across four dimensions.

## The Five Tiers

| Tier | Score | Meaning |
|------|-------|---------|
| **SHADOW** | 0–19 | No verified identity. Operating without delegation. |
| **BASIC** | 20–39 | Identity provisioned but delegation incomplete. |
| **VERIFIED** | 40–69 | Valid delegation chain, territorial binding confirmed. |
| **TRUSTED** | 70–89 | Consistent history, active staking, clean record. |
| **SOVEREIGN** | 90–100 | Full compliance across all dimensions. Enterprise-grade. |

## Scoring Dimensions

Each dimension contributes up to 25 points:

| Dimension | Max | What It Measures |
|-----------|-----|-----------------|
| **Delegation** | 25 | Valid chain to human root, cert not expired |
| **Territory** | 25 | Consistent H3 cell binding, no out-of-scope operations |
| **History** | 25 | Breadcrumb depth, epoch count, operational consistency |
| **Staking** | 25 | GNS tokens staked, minimum threshold met |

## Querying Compliance

::: code-group

```typescript [TypeScript]
const score = await sdk.getCompliance(agentId);
console.log(score.tier);       // "VERIFIED"
console.log(score.total);      // 85
console.log(score.delegation); // 25
```

```python [Python]
score = await sdk.get_compliance(agent_id)
print(score.tier)        # ComplianceTier.VERIFIED
print(score.total)       # 85
```

:::

## Tier Gating

Framework integrations can gate operations based on compliance tier:

```typescript
if (score.tier < 'VERIFIED') {
  throw new Error('Agent must reach VERIFIED tier for this operation');
}
```

In Python, `ComplianceTier` supports comparison operators:

```python
from gns_aip import ComplianceTier

if score.tier < ComplianceTier.VERIFIED:
    raise ValueError("Insufficient compliance tier")
```
