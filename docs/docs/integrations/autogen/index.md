# AutoGen / AG2 Integration

`autogen-gns-aip` adds identity and compliance to AutoGen agents via `register_function` + `register_reply`.

## Install

```bash
pip install autogen-gns-aip gns-aip
```

## Components

| Component | Purpose |
|-----------|---------|
| `create_delegation_check` | Function for `register_function()` tool registration |
| `GNSReplyHook` | `register_reply()` hook — breadcrumb per message exchange |
| `GNSAutoGenProvider` | One-call setup: provision + delegate + register |

## Quick Start

```python
from autogen import ConversableAgent
from autogen_gns_aip import GNSAutoGenProvider

gns = await GNSAutoGenProvider.create(
    backend_url="https://gns-browser-production.up.railway.app",
    agent_type="autonomous",
    agent_handle="my-agent",
)
await gns.delegate("ed25519-human-pk", actions=["search", "code"])

assistant = ConversableAgent(name="assistant", llm_config=llm_config)
user_proxy = ConversableAgent(name="user_proxy", human_input_mode="NEVER")

# One call wires tool + reply hooks + message hooks
gns.register_with(caller=assistant, executor=user_proxy)

user_proxy.initiate_chat(
    assistant,
    message="Research EU AI Act requirements",
    max_turns=3,
)
```

27 tests. Compatible with AG2 (the AutoGen fork) and original AutoGen.
