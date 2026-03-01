# Provisioning

Il provisioning dell'agente crea una nuova identità crittografica sulla rete GNS.

## Tipi di Agente

| Tipo | Descrizione | Caso d'Uso |
|------|-------------|------------|
| `autonomous` | Opera indipendentemente dopo la delega | Worker in background, task schedulati |
| `supervised` | Richiede approvazione umana per azioni sensibili | Sanità, consulenza finanziaria |
| `deterministic` | Comportamento fisso, nessun ragionamento LLM | Motori di regole, validatori |

## Celle Home

Ogni agente è vincolato a una o più **celle esagonali H3** al momento del provisioning. Queste celle definiscono il "territorio base" dell'agente.

## Staking Token GNS

Il provisioning richiede lo staking di **100 token GNS** per agente. Questo crea un costo economico contro gli attacchi Sybil.
