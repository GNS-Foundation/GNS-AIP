"""Pydantic models for GNS-AIP Agent Identity Protocol."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ─── Enums ────────────────────────────────────────────────────────────────────


class AgentType(str, Enum):
    AUTONOMOUS = "autonomous"
    SUPERVISED = "supervised"
    DETERMINISTIC = "deterministic"


class ComplianceTier(str, Enum):
    SHADOW = "SHADOW"
    BASIC = "BASIC"
    VERIFIED = "VERIFIED"
    TRUSTED = "TRUSTED"
    SOVEREIGN = "SOVEREIGN"

    @property
    def rank(self) -> int:
        return list(ComplianceTier).index(self)

    def __ge__(self, other: ComplianceTier) -> bool:  # type: ignore[override]
        return self.rank >= other.rank

    def __gt__(self, other: ComplianceTier) -> bool:  # type: ignore[override]
        return self.rank > other.rank

    def __le__(self, other: ComplianceTier) -> bool:  # type: ignore[override]
        return self.rank <= other.rank

    def __lt__(self, other: ComplianceTier) -> bool:  # type: ignore[override]
        return self.rank < other.rank


# ─── Provisioning ─────────────────────────────────────────────────────────────


class ProvisionRequest(BaseModel):
    agent_type: AgentType
    agent_handle: Optional[str] = None
    home_cells: Optional[list[str]] = None
    stellar_address: Optional[str] = None
    gns_staked: Optional[float] = None
    jurisdiction: Optional[str] = None


class ProvisionResult(BaseModel):
    agent_id: str
    pk_root: str
    agent_handle: Optional[str] = None
    status: str = "provisioned"


# ─── Delegation ───────────────────────────────────────────────────────────────


class DelegationScope(BaseModel):
    actions: list[str] = Field(default_factory=lambda: ["*"])
    resources: list[str] = Field(default_factory=lambda: ["*"])


class DelegateRequest(BaseModel):
    principal_pk: str
    agent_id: str
    scope: Optional[DelegationScope] = None
    territory: Optional[list[str]] = None
    expires_at: Optional[str] = None
    max_subdelegation_depth: Optional[int] = None


class DelegationCert(BaseModel):
    cert_hash: str
    delegator_pk: str
    delegate_pk: str
    chain_depth: int
    scope: DelegationScope
    territory: list[str] = Field(default_factory=list)
    issued_at: str
    expires_at: Optional[str] = None
    is_active: bool = True


# ─── Compliance ───────────────────────────────────────────────────────────────


class ComplianceScore(BaseModel):
    total: int
    tier: ComplianceTier
    delegation: int = 0
    territory: int = 0
    history: int = 0
    staking: int = 0
    total_breadcrumbs: int = 0
    violations: int = 0
    delegation_valid: bool = False


# ─── Agent Manifest ───────────────────────────────────────────────────────────


class AgentManifest(BaseModel):
    agent_id: str
    agent_handle: Optional[str] = None
    agent_type: AgentType = AgentType.AUTONOMOUS
    principal_pk: Optional[str] = None
    status: str = "active"
    compliance_score: Optional[ComplianceScore] = None
    delegation_chain: list[DelegationCert] = Field(default_factory=list)
    home_cells: list[str] = Field(default_factory=list)
    total_breadcrumbs: int = 0


# ─── Breadcrumbs ──────────────────────────────────────────────────────────────


class Breadcrumb(BaseModel):
    h3_cell: str
    operation_type: str
    operation_hash: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    metadata: dict[str, Any] = Field(default_factory=dict)


class BreadcrumbResult(BaseModel):
    accepted: int
    rejected: int
    epoch_created: bool = False


# ─── Delegation Chain Verification ────────────────────────────────────────────


class ChainVerification(BaseModel):
    valid: bool
    chain: list[dict[str, Any]] = Field(default_factory=list)
    human_root: str = ""
    depth: int = 0


class ScopeCheck(BaseModel):
    authorized: bool
    action: str = ""
    reason: str = ""


# ─── Escalation ──────────────────────────────────────────────────────────────


class EscalationResult(BaseModel):
    should_escalate: bool
    reason: str = ""
    policy: str = "default"
