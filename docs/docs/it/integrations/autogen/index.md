# Integrazione AutoGen / AG2

`autogen-gns-aip` aggiunge identità e conformità agli agenti AutoGen tramite `register_function` + `register_reply`.

```bash
pip install autogen-gns-aip gns-aip
```

| Componente | Scopo |
|-----------|-------|
| `create_delegation_check` | Funzione per registrazione tool `register_function()` |
| `GNSReplyHook` | Hook `register_reply()` — breadcrumb per ogni scambio di messaggi |
| `GNSAutoGenProvider` | Setup in una chiamata: provisioning + delega + registrazione |

27 test. Compatibile con AG2 (il fork di AutoGen) e AutoGen originale.
