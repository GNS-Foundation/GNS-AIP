"""Shared fixtures for GNS-AIP tests."""

from __future__ import annotations

import json
from typing import Any

import pytest
import httpx
from pytest_httpx import HTTPXMock

from gns_aip import GNSAgentSDK


# ─── Mock Backend Responses ───────────────────────────────────────────────────

PROVISION_RESPONSE = {
    "agentId": "agent-test-001",
    "pkRoot": "ed25519-mock-public-key-base64",
    "agentHandle": "test-agent",
    "status": "provisioned",
}

DELEGATE_RESPONSE = {
    "certHash": "mock-cert-hash-sha256",
    "delegatorPk": "human-principal-pk",
    "delegatePk": "ed25519-mock-public-key-base64",
    "chainDepth": 1,
    "scope": {"actions": ["*"], "resources": ["*"]},
    "territory": ["8a2a1072b59ffff"],
    "issuedAt": "2026-03-01T00:00:00Z",
    "expiresAt": None,
    "isActive": True,
}

MANIFEST_RESPONSE = {
    "agentId": "agent-test-001",
    "agentHandle": "test-agent",
    "agentType": "autonomous",
    "principalPk": "human-principal-pk",
    "status": "active",
    "complianceScore": {
        "total": 85,
        "tier": "VERIFIED",
        "delegation": 25,
        "territory": 20,
        "history": 20,
        "staking": 20,
        "totalBreadcrumbs": 150,
        "violations": 0,
        "delegationValid": True,
    },
    "delegationChain": [
        {
            "certHash": "cert-001",
            "delegatorPk": "human-principal-pk",
            "delegatePk": "ed25519-mock-public-key-base64",
            "chainDepth": 1,
            "scope": {"actions": ["*"], "resources": ["*"]},
            "territory": ["8a2a1072b59ffff"],
            "issuedAt": "2026-03-01T00:00:00Z",
            "isActive": True,
        }
    ],
    "homeCells": ["8a2a1072b59ffff"],
    "totalBreadcrumbs": 150,
}

COMPLIANCE_RESPONSE = {
    "total": 85,
    "tier": "VERIFIED",
    "delegation": 25,
    "territory": 20,
    "history": 20,
    "staking": 20,
    "totalBreadcrumbs": 150,
    "violations": 0,
    "delegationValid": True,
}

BREADCRUMB_RESPONSE = {
    "accepted": 5,
    "rejected": 0,
    "epochCreated": False,
}

RESTRICTED_MANIFEST = {
    **MANIFEST_RESPONSE,
    "delegationChain": [
        {
            **MANIFEST_RESPONSE["delegationChain"][0],
            "scope": {"actions": ["search", "code"], "resources": ["*"]},
        }
    ],
}


# ─── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def backend_url() -> str:
    return "http://test-gns-backend:3000"


@pytest.fixture
async def sdk(backend_url: str) -> GNSAgentSDK:
    client = GNSAgentSDK(backend_url)
    yield client  # type: ignore[misc]
    await client.close()


@pytest.fixture
def mock_all(httpx_mock: HTTPXMock, backend_url: str) -> HTTPXMock:
    """Register all standard mock responses."""
    httpx_mock.add_response(
        url=f"{backend_url}/api/agents/provision",
        method="POST",
        json=PROVISION_RESPONSE,
    )
    httpx_mock.add_response(
        url=f"{backend_url}/api/agents/delegate",
        method="POST",
        json=DELEGATE_RESPONSE,
    )
    httpx_mock.add_response(
        url=f"{backend_url}/api/agents/agent-test-001/manifest",
        method="GET",
        json=MANIFEST_RESPONSE,
    )
    httpx_mock.add_response(
        url=f"{backend_url}/api/agents/agent-test-001/compliance",
        method="GET",
        json=COMPLIANCE_RESPONSE,
    )
    httpx_mock.add_response(
        url=f"{backend_url}/api/agents/agent-test-001/breadcrumbs",
        method="POST",
        json=BREADCRUMB_RESPONSE,
    )
    return httpx_mock
