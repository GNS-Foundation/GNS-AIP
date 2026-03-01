# Integración AutoGen / AG2

`autogen-gns-aip` agrega identidad y cumplimiento a agentes AutoGen mediante `register_function` + `register_reply`.

```bash
pip install autogen-gns-aip gns-aip
```

| Componente | Propósito |
|-----------|-----------|
| `create_delegation_check` | Función para registro de herramienta `register_function()` |
| `GNSReplyHook` | Hook `register_reply()` — breadcrumb por intercambio de mensajes |
| `GNSAutoGenProvider` | Setup en una llamada: aprovisionamiento + delegación + registro |

27 tests. Compatible con AG2 (fork de AutoGen) y AutoGen original.
