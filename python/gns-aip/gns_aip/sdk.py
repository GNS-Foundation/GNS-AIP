"""GNS-AIP Agent SDK — Python client for the Agent Identity Protocol."""

from __future__ import annotations

from typing import Any, Optional

import httpx

from .models import (
    AgentManifest,
    AgentType,
    Breadcrumb,
    BreadcrumbResult,
    ComplianceScore,
    DelegateRequest,
    DelegationCert,
    DelegationScope,
    ProvisionRequest,
    ProvisionResult,
)


class GNSAgentSDK:
    """HTTP client for the GNS-AIP backend.

    Provides methods to provision agents, delegate authority, submit
    breadcrumbs, and query compliance — all with Ed25519 identity.

    Example::

        sdk = GNSAgentSDK(backend_url="https://gns-browser-production.up.railway.app")

        # Provision
        result = await sdk.provision_agent(
            agent_type="autonomous",
            agent_handle="my-agent",
            home_cells=["8a2a1072b59ffff"],
        )

        # Delegate
        cert = await sdk.delegate_to_agent(
            principal_pk="ed25519-human-pk",
            agent_id=result.agent_id,
            scope=DelegationScope(actions=["search", "code"]),
        )

        # Submit breadcrumbs
        await sdk.submit_breadcrumbs(result.agent_id, breadcrumbs)
    """

    def __init__(
        self,
        backend_url: str,
        *,
        timeout: float = 30.0,
        headers: Optional[dict[str, str]] = None,
    ) -> None:
        self.backend_url = backend_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self.backend_url,
            timeout=timeout,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "gns-aip-python/0.1.0",
                **(headers or {}),
            },
        )

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> GNSAgentSDK:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    # ─── Provisioning ─────────────────────────────────────────────────

    async def provision_agent(
        self,
        agent_type: str | AgentType = AgentType.AUTONOMOUS,
        *,
        agent_handle: Optional[str] = None,
        home_cells: Optional[list[str]] = None,
        stellar_address: Optional[str] = None,
        gns_staked: Optional[float] = None,
        jurisdiction: Optional[str] = None,
    ) -> ProvisionResult:
        """Provision a new agent identity on the GNS network.

        Returns the agent ID and Ed25519 public key root.
        """
        req = ProvisionRequest(
            agent_type=AgentType(agent_type),
            agent_handle=agent_handle,
            home_cells=home_cells,
            stellar_address=stellar_address,
            gns_staked=gns_staked,
            jurisdiction=jurisdiction,
        )

        resp = await self._client.post(
            "/api/agents/provision",
            json=req.model_dump(exclude_none=True),
        )
        resp.raise_for_status()
        data = resp.json()

        return ProvisionResult(
            agent_id=data["agentId"],
            pk_root=data["pkRoot"],
            agent_handle=data.get("agentHandle"),
            status=data.get("status", "provisioned"),
        )

    # ─── Delegation ───────────────────────────────────────────────────

    async def delegate_to_agent(
        self,
        principal_pk: str,
        agent_id: str,
        *,
        scope: Optional[DelegationScope] = None,
        territory: Optional[list[str]] = None,
        expires_at: Optional[str] = None,
        max_subdelegation_depth: Optional[int] = None,
    ) -> DelegationCert:
        """Delegate authority from a human principal to an agent.

        Creates a cryptographically-signed delegation certificate.
        """
        req = DelegateRequest(
            principal_pk=principal_pk,
            agent_id=agent_id,
            scope=scope,
            territory=territory,
            expires_at=expires_at,
            max_subdelegation_depth=max_subdelegation_depth,
        )

        resp = await self._client.post(
            "/api/agents/delegate",
            json=req.model_dump(exclude_none=True),
        )
        resp.raise_for_status()
        data = resp.json()

        return DelegationCert(
            cert_hash=data["certHash"],
            delegator_pk=data["delegatorPk"],
            delegate_pk=data["delegatePk"],
            chain_depth=data["chainDepth"],
            scope=DelegationScope(**(data.get("scope") or {})),
            territory=data.get("territory", []),
            issued_at=data["issuedAt"],
            expires_at=data.get("expiresAt"),
            is_active=data.get("isActive", True),
        )

    # ─── Agent Manifest ───────────────────────────────────────────────

    async def get_agent_manifest(self, agent_id: str) -> AgentManifest:
        """Retrieve the full agent manifest including delegation chain."""
        resp = await self._client.get(f"/api/agents/{agent_id}/manifest")
        resp.raise_for_status()
        data = resp.json()

        return AgentManifest.model_validate(
            _camel_to_snake_dict(data)
        )

    # ─── Compliance ───────────────────────────────────────────────────

    async def get_compliance(self, agent_id: str) -> ComplianceScore:
        """Get the current compliance score and tier."""
        resp = await self._client.get(f"/api/agents/{agent_id}/compliance")
        resp.raise_for_status()
        data = resp.json()

        return ComplianceScore.model_validate(
            _camel_to_snake_dict(data)
        )

    # ─── Breadcrumbs ──────────────────────────────────────────────────

    async def submit_breadcrumbs(
        self,
        agent_id: str,
        breadcrumbs: list[Breadcrumb],
    ) -> BreadcrumbResult:
        """Submit a batch of breadcrumbs for compliance tracking.

        Privacy: breadcrumbs contain only operation metadata,
        never prompts, completions, or user content.
        """
        payload = [
            {
                "h3Cell": b.h3_cell,
                "operationType": b.operation_type,
                "operationHash": b.operation_hash,
                "timestamp": b.timestamp,
                "metadata": b.metadata,
            }
            for b in breadcrumbs
        ]

        resp = await self._client.post(
            f"/api/agents/{agent_id}/breadcrumbs",
            json={"breadcrumbs": payload},
        )
        resp.raise_for_status()
        data = resp.json()

        return BreadcrumbResult(
            accepted=data.get("accepted", len(breadcrumbs)),
            rejected=data.get("rejected", 0),
            epoch_created=data.get("epochCreated", False),
        )


# ─── Delegation Chain Utilities ───────────────────────────────────────────────


class DelegationChain:
    """Static utilities for delegation chain verification."""

    @staticmethod
    async def verify(sdk: GNSAgentSDK, agent_id: str) -> dict[str, Any]:
        """Verify the entire delegation chain back to a human root.

        Returns::

            {
                "valid": True,
                "chain": [...],
                "human_root": "ed25519-pk",
                "depth": 1,
            }
        """
        try:
            manifest = await sdk.get_agent_manifest(agent_id)
            chain = manifest.delegation_chain

            if not chain:
                return {
                    "valid": False,
                    "chain": [],
                    "human_root": "",
                    "depth": 0,
                }

            # Walk chain to find human root
            root_pk = chain[0].delegator_pk if chain else ""
            all_active = all(c.is_active for c in chain)

            return {
                "valid": all_active and len(chain) > 0,
                "chain": [c.model_dump() for c in chain],
                "human_root": root_pk,
                "depth": len(chain),
            }
        except Exception:
            return {
                "valid": False,
                "chain": [],
                "human_root": "",
                "depth": 0,
            }

    @staticmethod
    async def check_scope(
        sdk: GNSAgentSDK,
        agent_id: str,
        action: str,
    ) -> dict[str, Any]:
        """Check if a specific action is within the delegation scope.

        Returns::

            {"authorized": True, "action": "search", "reason": "..."}
        """
        try:
            manifest = await sdk.get_agent_manifest(agent_id)
            chain = manifest.delegation_chain

            if not chain:
                return {
                    "authorized": False,
                    "action": action,
                    "reason": "No delegation chain found",
                }

            # Check latest delegation cert's scope
            latest = chain[-1]
            allowed_actions = latest.scope.actions

            if "*" in allowed_actions or action in allowed_actions:
                return {
                    "authorized": True,
                    "action": action,
                    "reason": "Action permitted by scope",
                }

            return {
                "authorized": False,
                "action": action,
                "reason": f"Action '{action}' not in scope: {allowed_actions}",
            }
        except Exception as e:
            return {
                "authorized": False,
                "action": action,
                "reason": f"Scope check failed: {e}",
            }


# ─── Escalation Policy ───────────────────────────────────────────────────────


class EscalationPolicy:
    """Static utilities for escalation policy evaluation."""

    @staticmethod
    async def evaluate(
        sdk: GNSAgentSDK,
        agent_id: str,
        context: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Evaluate whether the current context requires escalation.

        Returns::

            {"should_escalate": False, "reason": "...", "policy": "default"}
        """
        try:
            compliance = await sdk.get_compliance(agent_id)

            # Escalation triggers
            if compliance.violations > 0:
                return {
                    "should_escalate": True,
                    "reason": f"Agent has {compliance.violations} compliance violations",
                    "policy": "violation",
                }

            if compliance.tier.rank < 2:  # Below VERIFIED
                return {
                    "should_escalate": True,
                    "reason": f"Agent tier {compliance.tier.value} is below VERIFIED",
                    "policy": "low_tier",
                }

            if not compliance.delegation_valid:
                return {
                    "should_escalate": True,
                    "reason": "Delegation chain is invalid",
                    "policy": "invalid_delegation",
                }

            return {
                "should_escalate": False,
                "reason": "Within normal parameters",
                "policy": "default",
            }
        except Exception as e:
            return {
                "should_escalate": True,
                "reason": f"Compliance check failed: {e}",
                "policy": "error",
            }


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _camel_to_snake(name: str) -> str:
    """Convert camelCase to snake_case."""
    result: list[str] = []
    for i, ch in enumerate(name):
        if ch.isupper() and i > 0:
            result.append("_")
        result.append(ch.lower())
    return "".join(result)


def _camel_to_snake_dict(data: Any) -> Any:
    """Recursively convert dict keys from camelCase to snake_case."""
    if isinstance(data, dict):
        return {_camel_to_snake(k): _camel_to_snake_dict(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_camel_to_snake_dict(item) for item in data]
    return data
