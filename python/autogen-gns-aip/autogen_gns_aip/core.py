"""GNS-AIP integration for AutoGen/AG2 — identity, compliance, and delegation.

Provides:
- gns_check_delegation: Function for register_function() tool registration
- GNSReplyHook: register_reply() hook for breadcrumb tracking per message
- GNSMessageHooks: register_hook() hooks for message-level breadcrumbs
- GNSAutoGenProvider: One-call setup that wires everything together

Usage::

    from autogen import ConversableAgent
    from autogen_gns_aip import GNSAutoGenProvider

    gns = await GNSAutoGenProvider.create(
        backend_url="https://gns-browser-production.up.railway.app",
        agent_type="autonomous",
        agent_handle="my-autogen-agent",
        home_cells=["8a2a1072b59ffff"],
    )
    await gns.delegate("ed25519-human-pk", actions=["search", "code"])

    # Wire into agents
    gns.register_with(caller=assistant, executor=user_proxy)
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Annotated, Optional

from gns_aip import (
    GNSAgentSDK,
    Breadcrumb,
    ComplianceTier,
    DelegationChain,
    DelegationScope,
    EscalationPolicy,
)


# ─── Delegation Check Function ────────────────────────────────────────────────


def create_delegation_check(sdk: GNSAgentSDK, agent_id: str):
    """Create a delegation check function compatible with AutoGen register_function.

    Returns a function that can be registered via::

        from autogen import register_function
        register_function(
            check_fn,
            caller=assistant,
            executor=user_proxy,
            description="Check GNS-AIP delegation authorization",
        )
    """

    def gns_check_delegation(
        action: Annotated[str, "Action to check (e.g., 'search', 'code', 'payment')"] = "",
        territory: Annotated[str, "H3 cell to verify territory authorization"] = "",
    ) -> str:
        """Check GNS-AIP delegation authorization and compliance tier.

        Use before performing sensitive actions to verify this agent is authorized.
        """
        try:
            result = _run_async(_async_check(sdk, agent_id, action, territory))
        except Exception as e:
            result = {
                "authorized": False,
                "tier": "UNKNOWN",
                "summary": f"✗ Delegation check error: {e}. Operating in restricted mode.",
            }
        return _format_result(result)

    # Preserve function metadata for AutoGen schema generation
    gns_check_delegation.__name__ = "gns_check_delegation"
    gns_check_delegation.__doc__ = (
        "Check GNS-AIP delegation authorization and compliance tier. "
        "Use before performing sensitive actions to verify this agent is authorized."
    )

    return gns_check_delegation


async def _async_check(
    sdk: GNSAgentSDK, agent_id: str, action: str, territory: str,
) -> dict[str, Any]:
    """Core async delegation check logic."""
    try:
        # 1. Verify delegation chain
        chain = await DelegationChain.verify(sdk, agent_id)

        # 2. Check action scope
        action_ok = True
        action_reason = "No specific action checked"
        if action:
            scope_result = await DelegationChain.check_scope(sdk, agent_id, action)
            action_ok = scope_result["authorized"]
            action_reason = scope_result["reason"]

        # 3. Get compliance tier
        tier = "UNKNOWN"
        try:
            compliance = await sdk.get_compliance(agent_id)
            tier = compliance.tier.value
        except Exception:
            pass

        # 4. Territory check
        territory_ok = True
        if territory:
            try:
                manifest = await sdk.get_agent_manifest(agent_id)
                territory_ok = territory in manifest.home_cells or "*" in manifest.home_cells
            except Exception:
                territory_ok = False

        authorized = chain["valid"] and action_ok and territory_ok

        return {
            "authorized": authorized,
            "tier": tier,
            "chain_valid": chain["valid"],
            "chain_depth": chain["depth"],
            "human_root": chain["human_root"],
            "summary": (
                f"✓ Agent authorized at {tier} tier."
                + (f" Action '{action}' permitted." if action and action_ok else "")
                + (f" Territory {territory} within bounds." if territory and territory_ok else "")
            ) if authorized else (
                f"✗ Agent NOT authorized."
                + (f" Chain invalid." if not chain["valid"] else "")
                + (f" Action '{action}' denied: {action_reason}." if not action_ok else "")
                + (f" Territory {territory} outside bounds." if not territory_ok else "")
            ),
        }
    except Exception as e:
        return {
            "authorized": False,
            "tier": "UNKNOWN",
            "summary": f"✗ Delegation check error: {e}. Operating in restricted mode.",
        }


# ─── Reply Hook (breadcrumb per reply) ────────────────────────────────────────


class GNSReplyHook:
    """AutoGen register_reply() hook that records a breadcrumb per message exchange.

    Usage::

        hook = GNSReplyHook(sdk, agent_id)
        agent.register_reply([autogen.Agent], hook.reply_func, position=0)

    Privacy: NEVER logs message content — only records timing, sender name,
    and message length metadata.
    """

    def __init__(
        self,
        sdk: GNSAgentSDK,
        agent_id: str,
        *,
        default_h3_cell: str = "8a2a1072b59ffff",
        auto_flush: bool = True,
        flush_threshold: int = 50,
    ) -> None:
        self._sdk = sdk
        self._agent_id = agent_id
        self._h3_cell = default_h3_cell
        self._auto_flush = auto_flush
        self._flush_threshold = flush_threshold
        self._pending: list[Breadcrumb] = []
        self._stats = {
            "messages": 0,
            "replies": 0,
            "errors": 0,
            "pending": 0,
        }

    def _hash(self, data: str) -> str:
        h = 0
        for ch in data:
            h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
        return f"ag2-{h:08x}"

    def _record(self, op_type: str, metadata: dict[str, Any]) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        self._pending.append(Breadcrumb(
            h3_cell=self._h3_cell,
            operation_type=op_type,
            operation_hash=self._hash(f"{op_type}:{ts}"),
            timestamp=ts,
            metadata={**metadata, "agent_id": self._agent_id},
        ))
        self._stats["pending"] = len(self._pending)
        if self._auto_flush and len(self._pending) >= self._flush_threshold:
            self._try_flush()

    def _try_flush(self) -> None:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(self.flush())
            else:
                asyncio.run(self.flush())
        except RuntimeError:
            pass

    async def flush(self) -> Optional[dict[str, Any]]:
        """Submit pending breadcrumbs to the backend."""
        if not self._pending:
            return None
        batch = self._pending[:]
        self._pending.clear()
        self._stats["pending"] = 0
        try:
            result = await self._sdk.submit_breadcrumbs(self._agent_id, batch)
            return {"accepted": result.accepted, "rejected": result.rejected}
        except Exception:
            self._stats["errors"] += 1
            if len(self._pending) + len(batch) <= self._flush_threshold * 2:
                self._pending.extend(batch)
                self._stats["pending"] = len(self._pending)
            return None

    # ─── register_reply compatible function ───────────────────────────

    def reply_func(
        self,
        recipient: Any,
        messages: Optional[list[dict[str, Any]]] = None,
        sender: Optional[Any] = None,
        config: Optional[Any] = None,
    ) -> tuple[bool, None]:
        """AutoGen register_reply() compatible function.

        Always returns (False, None) so the conversation continues —
        this is a passthrough hook that only records breadcrumbs.

        Privacy: Records sender name and message count, never content.
        """
        self._stats["replies"] += 1

        metadata: dict[str, Any] = {"reply_number": self._stats["replies"]}

        if sender is not None:
            sender_name = getattr(sender, "name", str(sender))
            metadata["sender"] = sender_name

        if messages:
            metadata["message_count"] = len(messages)
            # Record length of last message, never content
            last = messages[-1]
            if isinstance(last, dict) and "content" in last:
                content = last["content"]
                if isinstance(content, str):
                    metadata["last_message_length"] = len(content)
                elif isinstance(content, list):
                    metadata["last_message_parts"] = len(content)

        self._record("autogen_reply", metadata)

        # Return (False, None) — don't intercept, let conversation continue
        return False, None

    # ─── Message hooks ────────────────────────────────────────────────

    def process_message_before_send(
        self,
        sender: Any,
        message: dict[str, Any] | str,
        recipient: Any,
        silent: bool,
    ) -> dict[str, Any] | str:
        """Hook for agent.register_hook("process_message_before_send", ...).

        Records outgoing message metadata. Returns message unchanged.

        Privacy: Records only recipient name and message length.
        """
        self._stats["messages"] += 1

        metadata: dict[str, Any] = {"direction": "outgoing"}
        if recipient is not None:
            metadata["recipient"] = getattr(recipient, "name", str(recipient))

        if isinstance(message, str):
            metadata["message_length"] = len(message)
        elif isinstance(message, dict) and "content" in message:
            content = message["content"]
            if isinstance(content, str):
                metadata["message_length"] = len(content)

        self._record("autogen_send", metadata)

        return message  # Pass through unchanged

    def process_last_received_message(
        self, messages: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Hook for agent.register_hook("process_last_received_message", ...).

        Records incoming message metadata. Returns messages unchanged.

        Privacy: Records only message count and last message length.
        """
        metadata: dict[str, Any] = {
            "direction": "incoming",
            "message_count": len(messages),
        }
        if messages:
            last = messages[-1]
            if isinstance(last, dict) and "content" in last:
                content = last["content"]
                if isinstance(content, str):
                    metadata["last_message_length"] = len(content)

        self._record("autogen_receive", metadata)

        return messages  # Pass through unchanged

    # ─── Accessors ────────────────────────────────────────────────────

    @property
    def stats(self) -> dict[str, int]:
        return {**self._stats}


# ─── Provider ─────────────────────────────────────────────────────────────────


class GNSAutoGenProvider:
    """One-call setup for GNS-AIP with AutoGen/AG2.

    Provisions identity, creates delegation check function and reply hooks.

    Usage::

        gns = await GNSAutoGenProvider.create(
            backend_url="https://gns-browser-production.up.railway.app",
            agent_type="autonomous",
            agent_handle="my-agent",
        )
        await gns.delegate("human-pk", actions=["search", "code"])

        # Wire into agents
        gns.register_with(caller=assistant, executor=user_proxy)
    """

    def __init__(
        self,
        sdk: GNSAgentSDK,
        agent_id: str,
        public_key: str,
        hook: GNSReplyHook,
        check_fn: Any,
    ) -> None:
        self._sdk = sdk
        self._agent_id = agent_id
        self._public_key = public_key
        self._hook = hook
        self._check_fn = check_fn
        self._delegated = False

    @staticmethod
    async def create(
        backend_url: str,
        agent_type: str = "autonomous",
        *,
        agent_handle: Optional[str] = None,
        home_cells: Optional[list[str]] = None,
        stellar_address: Optional[str] = None,
        gns_staked: Optional[float] = None,
        jurisdiction: Optional[str] = None,
    ) -> GNSAutoGenProvider:
        """Provision agent identity and create all AutoGen integrations."""
        sdk = GNSAgentSDK(backend_url)

        result = await sdk.provision_agent(
            agent_type=agent_type,
            agent_handle=agent_handle,
            home_cells=home_cells,
            stellar_address=stellar_address,
            gns_staked=gns_staked,
            jurisdiction=jurisdiction,
        )

        hook = GNSReplyHook(
            sdk, result.agent_id,
            default_h3_cell=home_cells[0] if home_cells else "8a2a1072b59ffff",
        )

        check_fn = create_delegation_check(sdk, result.agent_id)

        return GNSAutoGenProvider(sdk, result.agent_id, result.pk_root, hook, check_fn)

    # ─── Delegation ───────────────────────────────────────────────────

    async def delegate(
        self,
        principal_pk: str,
        *,
        actions: Optional[list[str]] = None,
        resources: Optional[list[str]] = None,
        territory: Optional[list[str]] = None,
        expires_at: Optional[str] = None,
    ) -> None:
        """Delegate authority from a human principal."""
        scope = DelegationScope(
            actions=actions or ["*"],
            resources=resources or ["*"],
        )
        await self._sdk.delegate_to_agent(
            principal_pk=principal_pk,
            agent_id=self._agent_id,
            scope=scope,
            territory=territory,
            expires_at=expires_at,
        )
        self._delegated = True

    # ─── Registration ─────────────────────────────────────────────────

    def register_with(
        self,
        caller: Any,
        executor: Any,
        *,
        register_hooks: bool = True,
    ) -> None:
        """Register GNS-AIP tool and hooks with AutoGen agents.

        Args:
            caller: The agent that suggests tool calls (e.g., AssistantAgent)
            executor: The agent that executes tools (e.g., UserProxyAgent)
            register_hooks: Also register reply/message hooks for breadcrumbs

        This calls autogen.register_function() and optionally registers
        reply hooks and message hooks on both agents.
        """
        try:
            from autogen import register_function
            register_function(
                self._check_fn,
                caller=caller,
                executor=executor,
                description="Check GNS-AIP delegation authorization and compliance tier",
            )
        except ImportError:
            # AutoGen not installed; store for manual registration
            pass

        if register_hooks:
            self._register_hooks(caller)
            self._register_hooks(executor)

    def _register_hooks(self, agent: Any) -> None:
        """Register reply and message hooks on an agent."""
        # register_reply for breadcrumb per reply cycle
        if hasattr(agent, "register_reply"):
            agent.register_reply(
                trigger=[object],  # Match all senders
                reply_func=self._hook.reply_func,
                position=0,  # Run first (before other reply funcs)
            )

        # Message hooks for send/receive tracking
        if hasattr(agent, "register_hook"):
            agent.register_hook(
                "process_message_before_send",
                self._hook.process_message_before_send,
            )
            agent.register_hook(
                "process_last_received_message",
                self._hook.process_last_received_message,
            )

    # ─── Accessors ────────────────────────────────────────────────────

    @property
    def delegation_check(self):
        """The delegation check function — for manual register_function()."""
        return self._check_fn

    @property
    def reply_hook(self) -> GNSReplyHook:
        """The reply hook — for manual register_reply()."""
        return self._hook

    @property
    def agent_id(self) -> str:
        return self._agent_id

    @property
    def public_key(self) -> str:
        return self._public_key

    @property
    def is_delegated(self) -> bool:
        return self._delegated

    # ─── Queries ──────────────────────────────────────────────────────

    async def get_compliance(self):
        return await self._sdk.get_compliance(self._agent_id)

    async def get_manifest(self):
        return await self._sdk.get_agent_manifest(self._agent_id)

    async def verify_delegation(self):
        return await DelegationChain.verify(self._sdk, self._agent_id)

    async def check_action(self, action: str):
        return await DelegationChain.check_scope(self._sdk, self._agent_id, action)

    async def check_escalation(self):
        return await EscalationPolicy.evaluate(self._sdk, self._agent_id)

    async def flush(self):
        return await self._hook.flush()

    @property
    def stats(self) -> dict[str, int]:
        return self._hook.stats


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _format_result(result: dict[str, Any]) -> str:
    lines = [result.get("summary", "")]
    if result.get("tier"):
        lines.append(f"Compliance Tier: {result['tier']}")
    if result.get("chain_depth"):
        lines.append(f"Delegation Depth: {result['chain_depth']}")
    return "\n".join(lines)


def _run_async(coro: Any) -> Any:
    """Run an async coroutine from sync context."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(asyncio.run, coro).result()
        else:
            return asyncio.run(coro)
    except RuntimeError:
        return asyncio.run(coro)
