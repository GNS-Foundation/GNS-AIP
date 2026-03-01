# Identità Agente

Ogni agente GNS-AIP ha un **keypair Ed25519**. La chiave pubblica serve un triplo scopo:

1. **Identità** — identifica univocamente l'agente sulla rete GNS
2. **Chiave di firma** — firma certificati di delega e breadcrumb
3. **Wallet Stellar** — riceve e mette in staking token GNS

Non ci sono username, password o API key. La chiave crittografica È l'identità.

## Tipi di Agente

| Tipo | Autonomia | Caso d'Uso |
|------|-----------|------------|
| `autonomous` | Completa | Worker in background, agenti schedulati |
| `supervised` | Controllata | Sanità, consulenza finanziaria |
| `deterministic` | Nessuna | Motori di regole, validatori |
