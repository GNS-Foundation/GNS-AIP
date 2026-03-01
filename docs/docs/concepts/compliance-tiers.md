# Compliance Tiers

GNS-AIP uses a 5-tier model that scores agents from 0 to 100 across four dimensions.

## Tiers

| Tier | Range | Description |
|------|-------|-------------|
| SHADOW | 0-19 | No verified identity |
| BASIC | 20-39 | Identity provisioned, delegation incomplete |
| VERIFIED | 40-69 | Valid delegation, territorial binding confirmed |
| TRUSTED | 70-89 | Consistent history, active staking |
| SOVEREIGN | 90-100 | Full compliance, enterprise-grade |

## Dimensions (25 points each)

| Dimension | Measures |
|-----------|---------|
| Delegation | Valid chain to human root, cert not expired |
| Territory | Consistent H3 binding, no out-of-scope operations |
| History | Breadcrumb depth, epoch count, consistency |
| Staking | GNS tokens staked above minimum |

## Tier Gating

Deployers can set minimum tier requirements for operations. A VERIFIED agent can access standard APIs; a SOVEREIGN agent can access sensitive data.
