"""Tests for crewai-gns-aip integration."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from gns_aip import Breadcrumb, ComplianceScore, ComplianceTier, DelegationScope
from gns_aip.models import AgentManifest, DelegationCert, ProvisionResult, BreadcrumbResult
from crewai_gns_aip import GNSCallbacks, GNSCrewProvider, GNSDelegationTool


# ─── Mock SDK ─────────────────────────────────────────────────────────────────


def make_mock_sdk():
    sdk = MagicMock()
    sdk.provision_agent = AsyncMock(return_value=ProvisionResult(
        agent_id="agent-crew-001",
        pk_root="ed25519-mock-pk",
        agent_handle="test-crew-agent",
    ))
    sdk.delegate_to_agent = AsyncMock(return_value=DelegationCert(
        cert_hash="cert-hash-001",
        delegator_pk="human-pk",
        delegate_pk="ed25519-mock-pk",
        chain_depth=1,
        scope=DelegationScope(actions=["*"], resources=["*"]),
        territory=["8a2a1072b59ffff"],
        issued_at="2026-03-01T00:00:00Z",
        is_active=True,
    ))
    sdk.get_agent_manifest = AsyncMock(return_value=AgentManifest(
        agent_id="agent-crew-001",
        agent_handle="test-crew-agent",
        home_cells=["8a2a1072b59ffff"],
        delegation_chain=[DelegationCert(
            cert_hash="cert-001",
            delegator_pk="human-pk",
            delegate_pk="ed25519-mock-pk",
            chain_depth=1,
            scope=DelegationScope(actions=["*"], resources=["*"]),
            territory=["8a2a1072b59ffff"],
            issued_at="2026-03-01T00:00:00Z",
            is_active=True,
        )],
    ))
    sdk.get_compliance = AsyncMock(return_value=ComplianceScore(
        total=85, tier=ComplianceTier.VERIFIED,
        delegation=25, territory=20, history=20, staking=20,
        delegation_valid=True,
    ))
    sdk.submit_breadcrumbs = AsyncMock(return_value=BreadcrumbResult(
        accepted=5, rejected=0, epoch_created=False,
    ))
    return sdk


# ─── GNSDelegationTool Tests ─────────────────────────────────────────────────


class TestGNSDelegationTool:
    def test_tool_has_name_and_description(self):
        sdk = make_mock_sdk()
        tool = GNSDelegationTool(sdk=sdk, agent_id="agent-001")
        assert tool.name == "gns_check_delegation"
        assert len(tool.description) > 20

    def test_tool_has_args_schema(self):
        sdk = make_mock_sdk()
        tool = GNSDelegationTool(sdk=sdk, agent_id="agent-001")
        assert tool.args_schema is not None

    async def test_async_check_authorized(self):
        sdk = make_mock_sdk()
        tool = GNSDelegationTool(sdk=sdk, agent_id="agent-001")
        result = await tool._async_check("search", "")
        assert result["authorized"] is True
        assert result["tier"] == "VERIFIED"
        assert "authorized" in result["summary"].lower()

    async def test_async_check_unauthorized_action(self):
        sdk = make_mock_sdk()
        # Make scope restricted
        manifest = await sdk.get_agent_manifest("x")
        manifest.delegation_chain[0].scope.actions = ["search", "code"]
        sdk.get_agent_manifest = AsyncMock(return_value=manifest)

        tool = GNSDelegationTool(sdk=sdk, agent_id="agent-001")

        # Mock check_scope via DelegationChain
        with patch("crewai_gns_aip.core.DelegationChain") as MockChain:
            MockChain.verify = AsyncMock(return_value={
                "valid": True, "chain": [], "human_root": "pk", "depth": 1,
            })
            MockChain.check_scope = AsyncMock(return_value={
                "authorized": False, "action": "payment", "reason": "Not in scope",
            })
            result = await tool._async_check("payment", "")
            assert result["authorized"] is False
            assert "NOT authorized" in result["summary"]

    async def test_async_check_territory(self):
        sdk = make_mock_sdk()
        tool = GNSDelegationTool(sdk=sdk, agent_id="agent-001")
        result = await tool._async_check("search", "8a2a1072b59ffff")
        assert result["authorized"] is True

    async def test_async_check_wrong_territory(self):
        sdk = make_mock_sdk()
        tool = GNSDelegationTool(sdk=sdk, agent_id="agent-001")
        result = await tool._async_check("search", "999999999999")
        assert result["authorized"] is False
        assert "outside bounds" in result["summary"]

    async def test_async_check_handles_error(self):
        sdk = make_mock_sdk()
        with patch("crewai_gns_aip.core.DelegationChain") as MockChain:
            MockChain.verify = AsyncMock(side_effect=Exception("network"))
            tool = GNSDelegationTool(sdk=sdk, agent_id="agent-001")
            result = await tool._async_check("search", "")
            assert result["authorized"] is False


# ─── GNSCallbacks Tests ──────────────────────────────────────────────────────


class TestGNSCallbacks:
    def test_step_callback_records_breadcrumb(self):
        sdk = make_mock_sdk()
        cb = GNSCallbacks(sdk, "agent-001", auto_flush=False)
        step = SimpleNamespace(tool="search_tool", text="some output", log="log")
        cb.step_callback(step)
        assert cb.stats["steps"] == 1
        assert cb.stats["pending"] == 1

    def test_task_callback_records_breadcrumb(self):
        sdk = make_mock_sdk()
        cb = GNSCallbacks(sdk, "agent-001", auto_flush=False)
        task = SimpleNamespace(description="Research AI", raw="Results here", agent="Researcher")
        cb.task_callback(task)
        assert cb.stats["tasks"] == 1
        assert cb.stats["pending"] == 1

    def test_step_callback_privacy(self):
        """Step callback should never record content — only metadata."""
        sdk = make_mock_sdk()
        cb = GNSCallbacks(sdk, "agent-001", auto_flush=False)
        step = SimpleNamespace(
            tool="sensitive_tool",
            text="My SSN is 123-45-6789 and my password is secret",
            result="Confidential financial data",
            log="Private log entry",
        )
        cb.step_callback(step)
        bc = cb._pending[0]
        serialized = str(bc.metadata)
        assert "123-45-6789" not in serialized
        assert "secret" not in serialized
        assert "Confidential" not in serialized
        assert "Private log" not in serialized
        # Should have lengths though
        assert bc.metadata["output_length"] > 0
        assert bc.metadata["tool_name"] == "sensitive_tool"

    def test_task_callback_privacy(self):
        sdk = make_mock_sdk()
        cb = GNSCallbacks(sdk, "agent-001", auto_flush=False)
        task = SimpleNamespace(
            description="Research user's private medical records",
            raw="Patient has condition X",
            agent="Medical Agent",
        )
        cb.task_callback(task)
        bc = cb._pending[0]
        serialized = str(bc.metadata)
        assert "medical records" not in serialized
        assert "condition X" not in serialized
        assert bc.metadata["description_length"] > 0

    def test_multiple_steps(self):
        sdk = make_mock_sdk()
        cb = GNSCallbacks(sdk, "agent-001", auto_flush=False)
        for i in range(5):
            cb.step_callback(SimpleNamespace(tool=f"tool-{i}"))
        assert cb.stats["steps"] == 5
        assert cb.stats["pending"] == 5

    async def test_flush(self):
        sdk = make_mock_sdk()
        cb = GNSCallbacks(sdk, "agent-001", auto_flush=False)
        cb.step_callback(SimpleNamespace(tool="t"))
        cb.step_callback(SimpleNamespace(tool="t"))
        result = await cb.flush()
        assert result is not None
        assert result["accepted"] == 5  # From mock
        assert cb.stats["pending"] == 0

    async def test_flush_empty(self):
        sdk = make_mock_sdk()
        cb = GNSCallbacks(sdk, "agent-001", auto_flush=False)
        result = await cb.flush()
        assert result is None

    async def test_flush_error_requeues(self):
        sdk = make_mock_sdk()
        sdk.submit_breadcrumbs = AsyncMock(side_effect=Exception("network"))
        cb = GNSCallbacks(sdk, "agent-001", auto_flush=False)
        cb.step_callback(SimpleNamespace(tool="t"))
        await cb.flush()
        assert cb.stats["pending"] == 1  # Re-queued
        assert cb.stats["errors"] == 1


# ─── GNSCrewProvider Tests ────────────────────────────────────────────────────


class TestGNSCrewProvider:
    async def test_create(self):
        with patch("crewai_gns_aip.core.GNSAgentSDK") as MockSDK:
            mock = make_mock_sdk()
            MockSDK.return_value = mock

            gns = await GNSCrewProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
                agent_handle="test-agent",
                home_cells=["8a2a1072b59ffff"],
            )

            assert gns.agent_id == "agent-crew-001"
            assert gns.public_key == "ed25519-mock-pk"
            assert gns.is_delegated is False

    async def test_delegate(self):
        with patch("crewai_gns_aip.core.GNSAgentSDK") as MockSDK:
            mock = make_mock_sdk()
            MockSDK.return_value = mock

            gns = await GNSCrewProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            await gns.delegate("human-pk", actions=["search"])
            assert gns.is_delegated is True

    async def test_provides_tool(self):
        with patch("crewai_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSCrewProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            assert isinstance(gns.delegation_tool, GNSDelegationTool)
            assert gns.delegation_tool.name == "gns_check_delegation"

    async def test_provides_callbacks(self):
        with patch("crewai_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSCrewProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            assert callable(gns.step_callback)
            assert callable(gns.task_callback)

    async def test_step_callback_tracks(self):
        with patch("crewai_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSCrewProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            gns.step_callback(SimpleNamespace(tool="search"))
            assert gns.stats["steps"] == 1

    async def test_get_compliance(self):
        with patch("crewai_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSCrewProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            compliance = await gns.get_compliance()
            assert compliance.tier == ComplianceTier.VERIFIED

    async def test_verify_delegation(self):
        with patch("crewai_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSCrewProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            result = await gns.verify_delegation()
            assert result["valid"] is True

    async def test_check_action(self):
        with patch("crewai_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSCrewProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            result = await gns.check_action("search")
            assert result["authorized"] is True

    async def test_flush(self):
        with patch("crewai_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSCrewProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            result = await gns.flush()
            assert result is None  # No pending

    async def test_integration_flow(self):
        """Full flow: create → delegate → step → task → flush."""
        with patch("crewai_gns_aip.core.GNSAgentSDK") as MockSDK:
            mock = make_mock_sdk()
            MockSDK.return_value = mock

            gns = await GNSCrewProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
                agent_handle="researcher",
                home_cells=["8a2a1072b59ffff"],
            )
            await gns.delegate("human-pk", actions=["search", "code"])

            # Simulate agent steps
            gns.step_callback(SimpleNamespace(tool="search", text="result"))
            gns.step_callback(SimpleNamespace(tool="code", text="code output"))
            gns.task_callback(SimpleNamespace(
                description="Research task", raw="findings", agent="Researcher",
            ))

            assert gns.stats["steps"] == 2
            assert gns.stats["tasks"] == 1
            assert gns.is_delegated is True

            # Flush
            result = await gns.flush()
            assert result is not None
