"""Tests for DelegationChain and EscalationPolicy utilities."""

import pytest
from pytest_httpx import HTTPXMock

pytestmark = pytest.mark.httpx_mock(assert_all_responses_were_requested=False)

from gns_aip import GNSAgentSDK, DelegationChain, EscalationPolicy
from tests.conftest import (
    MANIFEST_RESPONSE,
    COMPLIANCE_RESPONSE,
    RESTRICTED_MANIFEST,
)


class TestDelegationChainVerify:
    async def test_verify_valid_chain(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        result = await DelegationChain.verify(sdk, "agent-test-001")
        assert result["valid"] is True
        assert result["human_root"] == "human-principal-pk"
        assert result["depth"] == 1
        assert len(result["chain"]) == 1

    async def test_verify_empty_chain(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        empty_manifest = {**MANIFEST_RESPONSE, "delegationChain": []}
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/agent-test-001/manifest",
            json=empty_manifest,
        )
        result = await DelegationChain.verify(sdk, "agent-test-001")
        assert result["valid"] is False
        assert result["depth"] == 0

    async def test_verify_handles_network_error(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/agent-test-001/manifest",
            status_code=500,
        )
        result = await DelegationChain.verify(sdk, "agent-test-001")
        assert result["valid"] is False


class TestDelegationChainCheckScope:
    async def test_wildcard_scope_allows_all(self, sdk: GNSAgentSDK, mock_all: HTTPXMock):
        result = await DelegationChain.check_scope(sdk, "agent-test-001", "anything")
        assert result["authorized"] is True
        assert result["action"] == "anything"

    async def test_restricted_scope_allows_permitted(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/agent-test-001/manifest",
            json=RESTRICTED_MANIFEST,
        )
        result = await DelegationChain.check_scope(sdk, "agent-test-001", "search")
        assert result["authorized"] is True

    async def test_restricted_scope_blocks_forbidden(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/agent-test-001/manifest",
            json=RESTRICTED_MANIFEST,
        )
        result = await DelegationChain.check_scope(sdk, "agent-test-001", "payment")
        assert result["authorized"] is False
        assert "payment" in result["reason"]

    async def test_no_chain_denies(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        empty = {**MANIFEST_RESPONSE, "delegationChain": []}
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/agent-test-001/manifest",
            json=empty,
        )
        result = await DelegationChain.check_scope(sdk, "agent-test-001", "search")
        assert result["authorized"] is False

    async def test_handles_error(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/agent-test-001/manifest",
            status_code=500,
        )
        result = await DelegationChain.check_scope(sdk, "agent-test-001", "search")
        assert result["authorized"] is False
        assert "failed" in result["reason"].lower()


class TestEscalationPolicy:
    async def test_no_escalation_for_healthy_agent(
        self, sdk: GNSAgentSDK, mock_all: HTTPXMock
    ):
        result = await EscalationPolicy.evaluate(sdk, "agent-test-001")
        assert result["should_escalate"] is False
        assert result["policy"] == "default"

    async def test_escalate_on_violations(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        violation_compliance = {**COMPLIANCE_RESPONSE, "violations": 3}
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/agent-test-001/compliance",
            json=violation_compliance,
        )
        result = await EscalationPolicy.evaluate(sdk, "agent-test-001")
        assert result["should_escalate"] is True
        assert result["policy"] == "violation"

    async def test_escalate_on_low_tier(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        low_tier = {**COMPLIANCE_RESPONSE, "tier": "SHADOW"}
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/agent-test-001/compliance",
            json=low_tier,
        )
        result = await EscalationPolicy.evaluate(sdk, "agent-test-001")
        assert result["should_escalate"] is True
        assert result["policy"] == "low_tier"

    async def test_escalate_on_invalid_delegation(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        invalid = {**COMPLIANCE_RESPONSE, "delegationValid": False}
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/agent-test-001/compliance",
            json=invalid,
        )
        result = await EscalationPolicy.evaluate(sdk, "agent-test-001")
        assert result["should_escalate"] is True
        assert result["policy"] == "invalid_delegation"

    async def test_escalate_on_error(
        self, sdk: GNSAgentSDK, httpx_mock: HTTPXMock, backend_url: str
    ):
        httpx_mock.add_response(
            url=f"{backend_url}/api/agents/agent-test-001/compliance",
            status_code=500,
        )
        result = await EscalationPolicy.evaluate(sdk, "agent-test-001")
        assert result["should_escalate"] is True
        assert result["policy"] == "error"
