"""GNS-AIP — Agent Identity Protocol for the EU AI Act era.

Python SDK for agent provisioning, delegation, compliance tracking,
and breadcrumb submission on the GNS (Geospatial Naming System) network.

Quick start::

    from gns_aip import GNSAgentSDK, DelegationChain, DelegationScope

    async with GNSAgentSDK("https://gns-browser-production.up.railway.app") as sdk:
        result = await sdk.provision_agent(
            agent_type="autonomous",
            agent_handle="my-agent",
            home_cells=["8a2a1072b59ffff"],
        )
        await sdk.delegate_to_agent(
            principal_pk="ed25519-human-pk",
            agent_id=result.agent_id,
            scope=DelegationScope(actions=["search", "code"]),
        )
        chain = await DelegationChain.verify(sdk, result.agent_id)
"""

from .models import (
    AgentManifest,
    AgentType,
    Breadcrumb,
    BreadcrumbResult,
    ChainVerification,
    ComplianceScore,
    ComplianceTier,
    DelegateRequest,
    DelegationCert,
    DelegationScope,
    EscalationResult,
    ProvisionRequest,
    ProvisionResult,
    ScopeCheck,
)
from .sdk import (
    DelegationChain,
    EscalationPolicy,
    GNSAgentSDK,
)

__version__ = "0.1.0"

__all__ = [
    # SDK
    "GNSAgentSDK",
    "DelegationChain",
    "EscalationPolicy",
    # Models
    "AgentManifest",
    "AgentType",
    "Breadcrumb",
    "BreadcrumbResult",
    "ChainVerification",
    "ComplianceScore",
    "ComplianceTier",
    "DelegateRequest",
    "DelegationCert",
    "DelegationScope",
    "EscalationResult",
    "ProvisionRequest",
    "ProvisionResult",
    "ScopeCheck",
]
