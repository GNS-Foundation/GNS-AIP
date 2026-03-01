# Aprovisionamiento

El aprovisionamiento de agentes crea una nueva identidad criptográfica en la red GNS.

## Tipos de Agente

| Tipo | Descripción | Caso de Uso |
|------|-------------|-------------|
| `autonomous` | Opera independientemente después de la delegación | Workers en segundo plano, tareas programadas |
| `supervised` | Requiere aprobación humana para acciones sensibles | Salud, asesoría financiera |
| `deterministic` | Comportamiento fijo, sin razonamiento LLM | Motores de reglas, validadores |

## Celdas Home

Cada agente se vincula a una o más **celdas hexagonales H3** en el momento del aprovisionamiento.

## Staking de Tokens GNS

El aprovisionamiento requiere staking de **100 tokens GNS** por agente para crear un costo económico contra ataques Sybil.
