# Identidad del Agente

Cada agente GNS-AIP tiene un **par de claves Ed25519**. La clave pública cumple triple función:

1. **Identidad** — identifica unívocamente al agente en la red GNS
2. **Clave de firma** — firma certificados de delegación y breadcrumbs
3. **Wallet Stellar** — recibe y stakea tokens GNS

## Tipos de Agente

| Tipo | Autonomía | Caso de Uso |
|------|-----------|-------------|
| `autonomous` | Completa | Workers en segundo plano |
| `supervised` | Controlada | Salud, finanzas |
| `deterministic` | Ninguna | Motores de reglas |
