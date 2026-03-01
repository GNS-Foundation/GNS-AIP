"""Tests for GNS-AIP Pydantic models."""

import pytest
from gns_aip.models import (
    AgentType,
    Breadcrumb,
    ComplianceScore,
    ComplianceTier,
    DelegationScope,
    ProvisionRequest,
)


class TestComplianceTier:
    def test_tier_ordering(self):
        assert ComplianceTier.SHADOW < ComplianceTier.BASIC
        assert ComplianceTier.BASIC < ComplianceTier.VERIFIED
        assert ComplianceTier.VERIFIED < ComplianceTier.TRUSTED
        assert ComplianceTier.TRUSTED < ComplianceTier.SOVEREIGN

    def test_tier_comparison(self):
        assert ComplianceTier.VERIFIED >= ComplianceTier.BASIC
        assert ComplianceTier.SOVEREIGN >= ComplianceTier.SOVEREIGN
        assert not ComplianceTier.SHADOW >= ComplianceTier.VERIFIED

    def test_tier_rank(self):
        assert ComplianceTier.SHADOW.rank == 0
        assert ComplianceTier.SOVEREIGN.rank == 4


class TestDelegationScope:
    def test_default_scope(self):
        scope = DelegationScope()
        assert scope.actions == ["*"]
        assert scope.resources == ["*"]

    def test_custom_scope(self):
        scope = DelegationScope(actions=["search", "code"], resources=["docs"])
        assert "search" in scope.actions
        assert "docs" in scope.resources


class TestBreadcrumb:
    def test_auto_timestamp(self):
        bc = Breadcrumb(h3_cell="8a2a1072b59ffff", operation_type="test", operation_hash="abc123")
        assert bc.timestamp  # auto-generated

    def test_with_metadata(self):
        bc = Breadcrumb(
            h3_cell="8a2a1072b59ffff",
            operation_type="llm_call",
            operation_hash="hash-001",
            metadata={"tokens": 150, "model": "gpt-4o"},
        )
        assert bc.metadata["tokens"] == 150
        assert bc.metadata["model"] == "gpt-4o"


class TestProvisionRequest:
    def test_minimal(self):
        req = ProvisionRequest(agent_type=AgentType.AUTONOMOUS)
        assert req.agent_type == AgentType.AUTONOMOUS
        assert req.agent_handle is None

    def test_full(self):
        req = ProvisionRequest(
            agent_type=AgentType.SUPERVISED,
            agent_handle="my-agent",
            home_cells=["cell-1"],
            jurisdiction="IT",
        )
        assert req.agent_handle == "my-agent"
        assert req.jurisdiction == "IT"


class TestComplianceScore:
    def test_from_dict(self):
        score = ComplianceScore(
            total=85,
            tier=ComplianceTier.VERIFIED,
            delegation=25,
            territory=20,
            history=20,
            staking=20,
        )
        assert score.total == 85
        assert score.tier == ComplianceTier.VERIFIED
        assert score.tier >= ComplianceTier.BASIC
