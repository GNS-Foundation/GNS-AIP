"""crewai-gns-aip — GNS-AIP identity and compliance for CrewAI agents."""

from .core import (
    DelegationCheckInput,
    GNSCallbacks,
    GNSCrewProvider,
    GNSDelegationTool,
)

__version__ = "0.1.0"

__all__ = [
    "DelegationCheckInput",
    "GNSCallbacks",
    "GNSCrewProvider",
    "GNSDelegationTool",
]
