"""autogen-gns-aip — GNS-AIP identity and compliance for AutoGen/AG2 agents."""

from .core import (
    GNSAutoGenProvider,
    GNSReplyHook,
    create_delegation_check,
)

__version__ = "0.1.0"

__all__ = [
    "GNSAutoGenProvider",
    "GNSReplyHook",
    "create_delegation_check",
]
