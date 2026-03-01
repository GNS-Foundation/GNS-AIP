# autogen-gns-aip

GNS-AIP identity, compliance, and delegation for [AutoGen/AG2](https://docs.ag2.ai) agents.

Part of the [GNS-AIP](https://github.com/GNS-Foundation/GNS-AIP) monorepo.

## Install

```bash
pip install autogen-gns-aip
```

## Quick Start

```python
from autogen import ConversableAgent, register_function
from autogen_gns_aip import GNSAutoGenProvider

# 1. One-call setup
gns = await GNSAutoGenProvider.create(
    backend_url="https://gns-browser-production.up.railway.app",
    agent_type="autonomous",
    agent_handle="my-autogen-agent",
    home_cells=["8a2a1072b59ffff"],
)

# 2. Delegate to human
await gns.delegate("ed25519-human-pk", actions=["search", "code"])

# 3. Create AutoGen agents
assistant = ConversableAgent(
    name="assistant",
    system_message="You are a helpful assistant.",
    llm_config=llm_config,
)
user_proxy = ConversableAgent(
    name="user_proxy",
    human_input_mode="NEVER",
)

# 4. Wire GNS-AIP (registers tool + reply hooks + message hooks)
gns.register_with(caller=assistant, executor=user_proxy)

# 5. Run conversation — breadcrumbs auto-collected
user_proxy.initiate_chat(
    assistant,
    message="Research EU AI Act requirements",
    max_turns=3,
)
```

## Components

### GNSAutoGenProvider.register_with()

One call wires everything:

```python
gns.register_with(caller=assistant, executor=user_proxy)
```

This registers:
- **`gns_check_delegation`** tool via `register_function()` — agent can call mid-conversation
- **Reply hook** via `register_reply()` — breadcrumb per message exchange
- **Message hooks** via `register_hook()` — track send/receive metadata

### Manual Registration

For fine-grained control:

```python
# Tool only
register_function(
    gns.delegation_check,
    caller=assistant,
    executor=user_proxy,
    description="Check GNS-AIP delegation authorization",
)

# Reply hook only
assistant.register_reply([object], gns.reply_hook.reply_func, position=0)

# Message hooks only
assistant.register_hook("process_message_before_send", gns.reply_hook.process_message_before_send)
```

### Privacy Guarantees

| Hook | Records | NEVER Records |
|------|---------|---------------|
| reply_func | Sender name, message count, length | Message content |
| process_message_before_send | Recipient, message length | Message text |
| process_last_received_message | Message count, last length | Any content |

## Architecture

```
┌──────────────────────────────────────────┐
│      Your AutoGen/AG2 Application         │
│  ConversableAgent ↔ ConversableAgent      │
├──────────────────────────────────────────┤
│   autogen-gns-aip (this package)          │
│  register_function │ reply_hook │ hooks   │
├──────────────────────────────────────────┤
│        gns-aip (Python SDK)               │
│   provision │ delegate │ breadcrumbs      │
├──────────────────────────────────────────┤
│        GNS Backend (Railway)              │
└──────────────────────────────────────────┘
```

## License

MIT — GNS Foundation
