# Python Models

All models use Pydantic v2 with snake_case field names.

## ComplianceTier

```python
from gns_aip import ComplianceTier

# Supports comparison
ComplianceTier.SHADOW < ComplianceTier.VERIFIED  # True
ComplianceTier.TRUSTED >= ComplianceTier.BASIC    # True
```

## DelegationScope

```python
from gns_aip import DelegationScope

scope = DelegationScope(actions=["search", "code"], resources=["*"])
```

## ComplianceScore

```python
score.total           # 85
score.tier            # ComplianceTier.VERIFIED
score.delegation      # 25
score.territory       # 20
score.history         # 20
score.staking         # 20
score.delegation_valid  # True
```

## Breadcrumb

```python
from gns_aip import Breadcrumb

bc = Breadcrumb(
    h3_cell="8a2a1072b59ffff",
    operation_type="llm_call",
    operation_hash="abc123",
    metadata={"tool": "search"},
)
# bc.timestamp is auto-set to UTC now
```
