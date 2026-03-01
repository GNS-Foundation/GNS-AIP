"""GNS-AIP integration for CrewAI — identity, compliance, and delegation.

Provides:
- GNSDelegationTool: BaseTool subclass for in-conversation authorization checks
- GNSCallbacks: step_callback & task_callback factories for breadcrumb tracking
- GNSCrewProvider: One-call setup that wires everything together

Usage::

    from crewai_gns_aip import GNSCrewProvider

    gns = await GNSCrewProvider.create(
        backend_url="https://gns-browser-production.up.railway.app",
        agent_type="autonomous",
        agent_handle="my-crew-agent",
        home_cells=["8a2a1072b59ffff"],
    )
    await gns.delegate("ed25519-human-pk", actions=["search", "code"])

    agent = Agent(
        role="Researcher",
        tools=[gns.delegation_tool],
        step_callback=gns.step_callback,
    )
    crew = Crew(agents=[agent], tasks=[...], task_callback=gns.task_callback)
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Optional, Type

from pydantic import BaseModel, Field

from gns_aip import (
    GNSAgentSDK,
    Breadcrumb,
    ComplianceTier,
    DelegationChain,
    DelegationScope,
    EscalationPolicy,
)

# Try importing CrewAI; if not installed, define protocol-compatible base
try:
    from crewai.tools import BaseTool as CrewAIBaseTool
except ImportError:
    # Fallback for environments without crewai installed
    class CrewAIBaseTool(BaseModel):  # type: ignore[no-redef]
        """Minimal BaseTool protocol for type checking without crewai."""
        name: str = ""
        description: str = ""
        def _run(self, *args: Any, **kwargs: Any) -> str:
            raise NotImplementedError


# ─── Tool Input Schema ────────────────────────────────────────────────────────


class DelegationCheckInput(BaseModel):
    """Input schema for the GNS delegation check tool."""
    action: str = Field(
        default="",
        description="Action to check authorization for (e.g., 'search', 'code', 'email')",
    )
    territory: str = Field(
        default="",
        description="H3 cell index to verify territorial authorization",
    )


# ─── GNS Delegation Tool ─────────────────────────────────────────────────────


class GNSDelegationTool(CrewAIBaseTool):
    """CrewAI tool for checking GNS-AIP delegation authorization.

    Agents can use this tool mid-task to verify they are authorized
    before performing sensitive actions.
    """

    name: str = "gns_check_delegation"
    description: str = (
        "Check GNS-AIP delegation authorization and compliance tier. "
        "Use before performing sensitive actions to verify this agent is authorized. "
        "Input: action name (e.g., 'search', 'code', 'payment') and optional territory (H3 cell)."
    )
    args_schema: Type[BaseModel] = DelegationCheckInput

    # Internal state (not part of Pydantic schema for CrewAI)
    _sdk: Any = None
    _agent_id: str = ""

    model_config = {"arbitrary_types_allowed": True}

    def __init__(self, sdk: GNSAgentSDK, agent_id: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        object.__setattr__(self, "_sdk", sdk)
        object.__setattr__(self, "_agent_id", agent_id)

    def _run(self, action: str = "", territory: str = "") -> str:
        """Synchronous execution — runs async check in event loop."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    result = pool.submit(
                        asyncio.run, self._async_check(action, territory)
                    ).result()
            else:
                result = asyncio.run(self._async_check(action, territory))
        except Exception as e:
            result = {
                "authorized": False,
                "tier": "UNKNOWN",
                "summary": f"✗ Delegation check error: {e}. Operating in restricted mode.",
            }
        return _format_result(result)

    async def _async_check(self, action: str, territory: str) -> dict[str, Any]:
        """Core async delegation check logic."""
        try:
            sdk: GNSAgentSDK = object.__getattribute__(self, "_sdk")
            agent_id: str = object.__getattribute__(self, "_agent_id")

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


# ─── Callbacks ────────────────────────────────────────────────────────────────


class GNSCallbacks:
    """Factory for CrewAI step_callback and task_callback functions.

    Creates breadcrumbs for every agent step and task completion.
    Privacy: NEVER logs prompts, completions, or tool inputs/outputs —
    only records operation metadata (timing, tool names, output lengths).
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
            "steps": 0,
            "tasks": 0,
            "errors": 0,
            "pending": 0,
        }

    def _hash(self, data: str) -> str:
        h = 0
        for ch in data:
            h = ((h << 5) - h + ord(ch)) & 0xFFFFFFFF
        return f"crew-{h:08x}"

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
            # Re-queue on failure (bounded)
            if len(self._pending) + len(batch) <= self._flush_threshold * 2:
                self._pending.extend(batch)
                self._stats["pending"] = len(self._pending)
            return None

    def _try_flush(self) -> None:
        """Attempt async flush if conditions met."""
        if self._auto_flush or len(self._pending) >= self._flush_threshold:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(self.flush())
                else:
                    asyncio.run(self.flush())
            except RuntimeError:
                pass  # No event loop available

    # ─── step_callback ────────────────────────────────────────────────

    def step_callback(self, step_output: Any) -> None:
        """CrewAI step_callback — records breadcrumb for each agent step.

        Pass to Agent(step_callback=gns.step_callback).

        Privacy: Records step type and output length, never content.
        """
        self._stats["steps"] += 1

        # Extract safe metadata from step output
        metadata: dict[str, Any] = {"step_number": self._stats["steps"]}

        if hasattr(step_output, "tool"):
            metadata["tool_name"] = str(step_output.tool)
        if hasattr(step_output, "text"):
            metadata["output_length"] = len(str(step_output.text))
        if hasattr(step_output, "result"):
            metadata["result_length"] = len(str(step_output.result))
        if hasattr(step_output, "log"):
            metadata["log_length"] = len(str(step_output.log))

        self._record("crew_step", metadata)
        self._try_flush()

    # ─── task_callback ────────────────────────────────────────────────

    def task_callback(self, task_output: Any) -> None:
        """CrewAI task_callback — records breadcrumb for each completed task.

        Pass to Crew(task_callback=gns.task_callback).

        Privacy: Records task description length and output length, never content.
        """
        self._stats["tasks"] += 1

        metadata: dict[str, Any] = {"task_number": self._stats["tasks"]}

        if hasattr(task_output, "description"):
            metadata["description_length"] = len(str(task_output.description))
        if hasattr(task_output, "raw"):
            metadata["output_length"] = len(str(task_output.raw))
        if hasattr(task_output, "pydantic"):
            metadata["has_structured_output"] = task_output.pydantic is not None
        if hasattr(task_output, "agent"):
            metadata["agent_role"] = str(task_output.agent)

        self._record("crew_task", metadata)
        self._try_flush()

    # ─── Accessors ────────────────────────────────────────────────────

    @property
    def stats(self) -> dict[str, int]:
        return {**self._stats}


# ─── Provider ─────────────────────────────────────────────────────────────────


class GNSCrewProvider:
    """One-call setup for GNS-AIP with CrewAI.

    Provisions identity, creates delegation tool and callbacks.

    Usage::

        gns = await GNSCrewProvider.create(
            backend_url="https://gns-browser-production.up.railway.app",
            agent_type="autonomous",
            agent_handle="my-crew-agent",
        )
        await gns.delegate("human-pk", actions=["search", "code"])

        agent = Agent(
            role="Researcher",
            tools=[gns.delegation_tool],
            step_callback=gns.step_callback,
        )
    """

    def __init__(
        self,
        sdk: GNSAgentSDK,
        agent_id: str,
        public_key: str,
        callbacks: GNSCallbacks,
        tool: GNSDelegationTool,
    ) -> None:
        self._sdk = sdk
        self._agent_id = agent_id
        self._public_key = public_key
        self._callbacks = callbacks
        self._tool = tool
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
    ) -> GNSCrewProvider:
        """Provision agent identity and create all CrewAI integrations."""
        sdk = GNSAgentSDK(backend_url)

        result = await sdk.provision_agent(
            agent_type=agent_type,
            agent_handle=agent_handle,
            home_cells=home_cells,
            stellar_address=stellar_address,
            gns_staked=gns_staked,
            jurisdiction=jurisdiction,
        )

        callbacks = GNSCallbacks(
            sdk, result.agent_id,
            default_h3_cell=home_cells[0] if home_cells else "8a2a1072b59ffff",
        )

        tool = GNSDelegationTool(sdk=sdk, agent_id=result.agent_id)

        return GNSCrewProvider(sdk, result.agent_id, result.pk_root, callbacks, tool)

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

    # ─── Accessors ────────────────────────────────────────────────────

    @property
    def delegation_tool(self) -> GNSDelegationTool:
        """The delegation tool — add to Agent(tools=[...])."""
        return self._tool

    @property
    def step_callback(self):
        """Step callback — pass to Agent(step_callback=...)."""
        return self._callbacks.step_callback

    @property
    def task_callback(self):
        """Task callback — pass to Crew(task_callback=...)."""
        return self._callbacks.task_callback

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
        return await self._callbacks.flush()

    @property
    def stats(self) -> dict[str, int]:
        return self._callbacks.stats


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _format_result(result: dict[str, Any]) -> str:
    """Format delegation check result as readable string for the LLM."""
    lines = [result.get("summary", "")]
    if result.get("tier"):
        lines.append(f"Compliance Tier: {result['tier']}")
    if result.get("chain_depth"):
        lines.append(f"Delegation Depth: {result['chain_depth']}")
    return "\n".join(lines)
