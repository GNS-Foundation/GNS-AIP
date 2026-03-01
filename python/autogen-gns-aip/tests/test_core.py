"""Tests for autogen-gns-aip integration."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

from gns_aip import Breadcrumb, ComplianceScore, ComplianceTier, DelegationScope
from gns_aip.models import AgentManifest, DelegationCert, ProvisionResult, BreadcrumbResult
from autogen_gns_aip import GNSAutoGenProvider, GNSReplyHook, create_delegation_check


# ─── Mock SDK ─────────────────────────────────────────────────────────────────


def make_mock_sdk():
    sdk = MagicMock()
    sdk.provision_agent = AsyncMock(return_value=ProvisionResult(
        agent_id="agent-ag2-001",
        pk_root="ed25519-mock-pk",
        agent_handle="test-ag2-agent",
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
        agent_id="agent-ag2-001",
        agent_handle="test-ag2-agent",
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


# ─── Mock AutoGen Agent ───────────────────────────────────────────────────────


class MockAgent:
    """Minimal mock of autogen.ConversableAgent for testing."""

    def __init__(self, name: str = "mock_agent"):
        self.name = name
        self._reply_funcs: list = []
        self._hooks: dict[str, list] = {
            "process_message_before_send": [],
            "process_last_received_message": [],
        }
        self._function_map: dict = {}

    def register_reply(self, trigger, reply_func, position=0, **kwargs):
        self._reply_funcs.insert(position, (trigger, reply_func))

    def register_hook(self, hook_name: str, hook_fn):
        if hook_name in self._hooks:
            self._hooks[hook_name].append(hook_fn)

    def register_function(self, function_map):
        self._function_map.update(function_map)


# ─── create_delegation_check Tests ───────────────────────────────────────────


class TestCreateDelegationCheck:
    def test_returns_callable(self):
        sdk = make_mock_sdk()
        fn = create_delegation_check(sdk, "agent-001")
        assert callable(fn)
        assert fn.__name__ == "gns_check_delegation"

    def test_has_docstring(self):
        sdk = make_mock_sdk()
        fn = create_delegation_check(sdk, "agent-001")
        assert "delegation" in fn.__doc__.lower()

    def test_has_annotations(self):
        sdk = make_mock_sdk()
        fn = create_delegation_check(sdk, "agent-001")
        import inspect
        sig = inspect.signature(fn)
        assert "action" in sig.parameters
        assert "territory" in sig.parameters


class TestAsyncCheck:
    async def test_authorized(self):
        from autogen_gns_aip.core import _async_check
        sdk = make_mock_sdk()
        result = await _async_check(sdk, "agent-001", "search", "")
        assert result["authorized"] is True
        assert result["tier"] == "VERIFIED"

    async def test_territory_authorized(self):
        from autogen_gns_aip.core import _async_check
        sdk = make_mock_sdk()
        result = await _async_check(sdk, "agent-001", "", "8a2a1072b59ffff")
        assert result["authorized"] is True

    async def test_territory_denied(self):
        from autogen_gns_aip.core import _async_check
        sdk = make_mock_sdk()
        result = await _async_check(sdk, "agent-001", "", "999999999999")
        assert result["authorized"] is False
        assert "outside bounds" in result["summary"]

    async def test_handles_error(self):
        from autogen_gns_aip.core import _async_check
        sdk = make_mock_sdk()
        with patch("autogen_gns_aip.core.DelegationChain") as MockChain:
            MockChain.verify = AsyncMock(side_effect=Exception("network"))
            result = await _async_check(sdk, "agent-001", "search", "")
            assert result["authorized"] is False
            assert "error" in result["summary"].lower()

    async def test_unauthorized_action(self):
        from autogen_gns_aip.core import _async_check
        sdk = make_mock_sdk()
        with patch("autogen_gns_aip.core.DelegationChain") as MockChain:
            MockChain.verify = AsyncMock(return_value={
                "valid": True, "chain": [], "human_root": "pk", "depth": 1,
            })
            MockChain.check_scope = AsyncMock(return_value={
                "authorized": False, "action": "payment", "reason": "Not in scope",
            })
            result = await _async_check(sdk, "agent-001", "payment", "")
            assert result["authorized"] is False


# ─── GNSReplyHook Tests ──────────────────────────────────────────────────────


class TestGNSReplyHook:
    def test_reply_func_records_breadcrumb(self):
        sdk = make_mock_sdk()
        hook = GNSReplyHook(sdk, "agent-001", auto_flush=False)
        sender = SimpleNamespace(name="assistant")
        messages = [{"role": "assistant", "content": "Hello world"}]

        result = hook.reply_func(
            recipient=SimpleNamespace(name="user"),
            messages=messages,
            sender=sender,
        )

        # Must return (False, None) to not intercept
        assert result == (False, None)
        assert hook.stats["replies"] == 1
        assert hook.stats["pending"] == 1

    def test_reply_func_privacy(self):
        """Reply hook should never record message content."""
        sdk = make_mock_sdk()
        hook = GNSReplyHook(sdk, "agent-001", auto_flush=False)
        messages = [{"role": "user", "content": "My SSN is 123-45-6789 and password is secret123"}]

        hook.reply_func(
            recipient=None,
            messages=messages,
            sender=SimpleNamespace(name="user"),
        )

        bc = hook._pending[0]
        serialized = str(bc.metadata)
        assert "123-45-6789" not in serialized
        assert "secret123" not in serialized
        assert "password" not in serialized
        assert bc.metadata["last_message_length"] > 0

    def test_reply_func_no_messages(self):
        sdk = make_mock_sdk()
        hook = GNSReplyHook(sdk, "agent-001", auto_flush=False)
        result = hook.reply_func(recipient=None, messages=None, sender=None)
        assert result == (False, None)
        assert hook.stats["replies"] == 1

    def test_process_message_before_send(self):
        sdk = make_mock_sdk()
        hook = GNSReplyHook(sdk, "agent-001", auto_flush=False)
        msg = {"role": "assistant", "content": "I'll search for that."}

        returned = hook.process_message_before_send(
            sender=SimpleNamespace(name="assistant"),
            message=msg,
            recipient=SimpleNamespace(name="user"),
            silent=False,
        )

        assert returned is msg  # Passthrough
        assert hook.stats["messages"] == 1
        bc = hook._pending[0]
        assert bc.operation_type == "autogen_send"
        assert bc.metadata["recipient"] == "user"
        assert "I'll search" not in str(bc.metadata)

    def test_process_message_string(self):
        sdk = make_mock_sdk()
        hook = GNSReplyHook(sdk, "agent-001", auto_flush=False)

        returned = hook.process_message_before_send(
            sender=None, message="plain text", recipient=SimpleNamespace(name="bot"), silent=False,
        )

        assert returned == "plain text"
        assert hook._pending[0].metadata["message_length"] == 10

    def test_process_last_received_message(self):
        sdk = make_mock_sdk()
        hook = GNSReplyHook(sdk, "agent-001", auto_flush=False)
        messages = [
            {"role": "user", "content": "First"},
            {"role": "assistant", "content": "Second message"},
        ]

        returned = hook.process_last_received_message(messages)

        assert returned is messages  # Passthrough
        bc = hook._pending[0]
        assert bc.operation_type == "autogen_receive"
        assert bc.metadata["message_count"] == 2

    def test_multiple_hooks(self):
        sdk = make_mock_sdk()
        hook = GNSReplyHook(sdk, "agent-001", auto_flush=False)

        for i in range(5):
            hook.reply_func(recipient=None, messages=[{"content": f"msg-{i}"}], sender=None)

        assert hook.stats["replies"] == 5
        assert hook.stats["pending"] == 5

    async def test_flush(self):
        sdk = make_mock_sdk()
        hook = GNSReplyHook(sdk, "agent-001", auto_flush=False)
        hook.reply_func(recipient=None, messages=[{"content": "x"}], sender=None)
        hook.reply_func(recipient=None, messages=[{"content": "y"}], sender=None)

        result = await hook.flush()
        assert result is not None
        assert result["accepted"] == 5  # From mock
        assert hook.stats["pending"] == 0

    async def test_flush_empty(self):
        sdk = make_mock_sdk()
        hook = GNSReplyHook(sdk, "agent-001", auto_flush=False)
        result = await hook.flush()
        assert result is None

    async def test_flush_error_requeues(self):
        sdk = make_mock_sdk()
        sdk.submit_breadcrumbs = AsyncMock(side_effect=Exception("network"))
        hook = GNSReplyHook(sdk, "agent-001", auto_flush=False)
        hook.reply_func(recipient=None, messages=[{"content": "x"}], sender=None)
        await hook.flush()
        assert hook.stats["pending"] == 1
        assert hook.stats["errors"] == 1


# ─── GNSAutoGenProvider Tests ────────────────────────────────────────────────


class TestGNSAutoGenProvider:
    async def test_create(self):
        with patch("autogen_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSAutoGenProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
                agent_handle="test",
                home_cells=["8a2a1072b59ffff"],
            )
            assert gns.agent_id == "agent-ag2-001"
            assert gns.public_key == "ed25519-mock-pk"
            assert gns.is_delegated is False

    async def test_delegate(self):
        with patch("autogen_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSAutoGenProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            await gns.delegate("human-pk", actions=["search"])
            assert gns.is_delegated is True

    async def test_provides_check_fn(self):
        with patch("autogen_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSAutoGenProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            assert callable(gns.delegation_check)
            assert gns.delegation_check.__name__ == "gns_check_delegation"

    async def test_provides_reply_hook(self):
        with patch("autogen_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSAutoGenProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            assert isinstance(gns.reply_hook, GNSReplyHook)

    async def test_register_with_mock_agents(self):
        """Test register_with() wires hooks correctly."""
        with patch("autogen_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSAutoGenProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )

            caller = MockAgent("assistant")
            executor = MockAgent("user_proxy")
            gns.register_with(caller=caller, executor=executor)

            # Both should have reply hooks
            assert len(caller._reply_funcs) == 1
            assert len(executor._reply_funcs) == 1

            # Both should have message hooks
            assert len(caller._hooks["process_message_before_send"]) == 1
            assert len(caller._hooks["process_last_received_message"]) == 1
            assert len(executor._hooks["process_message_before_send"]) == 1

    async def test_register_without_hooks(self):
        with patch("autogen_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSAutoGenProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            agent = MockAgent("test")
            gns.register_with(caller=agent, executor=agent, register_hooks=False)
            assert len(agent._reply_funcs) == 0

    async def test_get_compliance(self):
        with patch("autogen_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSAutoGenProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            compliance = await gns.get_compliance()
            assert compliance.tier == ComplianceTier.VERIFIED

    async def test_verify_delegation(self):
        with patch("autogen_gns_aip.core.GNSAgentSDK") as MockSDK:
            MockSDK.return_value = make_mock_sdk()
            gns = await GNSAutoGenProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
            )
            result = await gns.verify_delegation()
            assert result["valid"] is True

    async def test_integration_flow(self):
        """Full flow: create → delegate → register → simulate → flush."""
        with patch("autogen_gns_aip.core.GNSAgentSDK") as MockSDK:
            mock = make_mock_sdk()
            MockSDK.return_value = mock

            gns = await GNSAutoGenProvider.create(
                backend_url="http://localhost:3000",
                agent_type="autonomous",
                agent_handle="researcher",
                home_cells=["8a2a1072b59ffff"],
            )
            await gns.delegate("human-pk", actions=["search", "code"])

            # Register with mock agents
            caller = MockAgent("assistant")
            executor = MockAgent("executor")
            gns.register_with(caller=caller, executor=executor)

            # Simulate conversation via hooks
            hook = gns.reply_hook
            hook.reply_func(
                recipient=executor,
                messages=[{"role": "assistant", "content": "Searching..."}],
                sender=caller,
            )
            hook.process_message_before_send(
                sender=caller,
                message="Let me search for that",
                recipient=executor,
                silent=False,
            )

            assert gns.stats["replies"] == 1
            assert gns.stats["messages"] == 1
            assert gns.is_delegated is True

            result = await gns.flush()
            assert result is not None
