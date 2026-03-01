"""Tests for GNSAgentSDK HTTP client."""

import pytest
from pytest_httpx import HTTPXMock

pytestmark = pytest.mark.httpx_mock(assert_all_responses_were_requested=False)

from gns_aip import GNSAgentSDK, Breadcrumb, DelegationScope
from gns_aip.models import ComplianceTier
from tests.conftest import (
    PROVISION_RESPONSE,
    DELEGATE_RESPONSE,
    MANIFEST_RESPONSE,
    COMPLIANCE_RESPONSE,
    BREADCRUMB_RESPONSE,
)


class TestProvisionAgent:
    async def test_provision_minimal(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        result = await sdk.provision_agent(agent_type="autonomous")
        assert result.agent_id == "agent-test-001"
        assert result.pk_root == "ed25519-mock-public-key-base64"
        assert result.status == "provisioned"

    async def test_provision_with_handle(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        result = await sdk.provision_agent(
            agent_type="supervised",
            agent_handle="my-agent",
            home_cells=["8a2a1072b59ffff"],
        )
        assert result.agent_handle == "test-agent"

    async def test_provision_with_all_options(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        result = await sdk.provision_agent(
            agent_type="deterministic",
            agent_handle="full-agent",
            home_cells=["cell-1", "cell-2"],
            stellar_address="GXYZ...",
            gns_staked=1000.0,
            jurisdiction="IT",
        )
        assert result.agent_id == "agent-test-001"

    async def test_provision_sends_correct_payload(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/provision",
            method="POST",
            json=PROVISION_RESPONSE,
        )
        await sdk.provision_agent(
            agent_type="autonomous",
            agent_handle="test",
            home_cells=["cell-1"],
        )
        request = httpx_mock.get_requests()[0]
        import json
        body = json.loads(request.content)
        assert body["agent_type"] == "autonomous"
        assert body["agent_handle"] == "test"
        assert body["home_cells"] == ["cell-1"]


class TestDelegateToAgent:
    async def test_delegate(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        cert = await sdk.delegate_to_agent(
            principal_pk="human-pk",
            agent_id="agent-test-001",
        )
        assert cert.cert_hash == "mock-cert-hash-sha256"
        assert cert.chain_depth == 1
        assert cert.is_active is True

    async def test_delegate_with_scope(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        cert = await sdk.delegate_to_agent(
            principal_pk="human-pk",
            agent_id="agent-test-001",
            scope=DelegationScope(actions=["search", "code"]),
            territory=["8a2a1072b59ffff"],
        )
        assert cert.delegator_pk == "human-principal-pk"
        assert cert.delegate_pk == "ed25519-mock-public-key-base64"


class TestGetAgentManifest:
    async def test_get_manifest(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        manifest = await sdk.get_agent_manifest("agent-test-001")
        assert manifest.agent_id == "agent-test-001"
        assert manifest.agent_handle == "test-agent"
        assert manifest.status == "active"
        assert len(manifest.delegation_chain) == 1
        assert manifest.home_cells == ["8a2a1072b59ffff"]
        assert manifest.total_breadcrumbs == 150

    async def test_manifest_compliance_score(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        manifest = await sdk.get_agent_manifest("agent-test-001")
        assert manifest.compliance_score is not None
        assert manifest.compliance_score.total == 85
        assert manifest.compliance_score.tier == ComplianceTier.VERIFIED


class TestGetCompliance:
    async def test_get_compliance(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        score = await sdk.get_compliance("agent-test-001")
        assert score.total == 85
        assert score.tier == ComplianceTier.VERIFIED
        assert score.delegation == 25
        assert score.violations == 0
        assert score.delegation_valid is True

    async def test_compliance_tier_comparison(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        score = await sdk.get_compliance("agent-test-001")
        assert score.tier >= ComplianceTier.BASIC
        assert score.tier < ComplianceTier.TRUSTED


class TestSubmitBreadcrumbs:
    async def test_submit(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        breadcrumbs = [
            Breadcrumb(
                h3_cell="8a2a1072b59ffff",
                operation_type="llm_call",
                operation_hash=f"hash-{i}",
                metadata={"tokens": 100},
            )
            for i in range(5)
        ]
        result = await sdk.submit_breadcrumbs("agent-test-001", breadcrumbs)
        assert result.accepted == 5
        assert result.rejected == 0
        assert result.epoch_created is False

    async def test_submit_sends_correct_payload(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/agent-test-001/breadcrumbs",
            method="POST",
            json=BREADCRUMB_RESPONSE,
        )
        bc = Breadcrumb(
            h3_cell="cell-1",
            operation_type="test",
            operation_hash="hash-1",
            metadata={"key": "value"},
        )
        await sdk.submit_breadcrumbs("agent-test-001", [bc])
        request = httpx_mock.get_requests()[0]
        import json
        body = json.loads(request.content)
        assert "breadcrumbs" in body
        assert body["breadcrumbs"][0]["h3Cell"] == "cell-1"
        assert body["breadcrumbs"][0]["operationType"] == "test"


class TestContextManager:
    async def test_async_context_manager(self, backend_url: str):
        async with GNSAgentSDK(backend_url) as sdk:
            assert sdk.backend_url == backend_url
        # Should be closed after exiting


class TestErrorHandling:
    async def test_provision_http_error(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/provision",
            method="POST",
            status_code=500,
            json={"error": "Internal server error"},
        )
        with pytest.raises(Exception):
            await sdk.provision_agent(agent_type="autonomous")
