# ¿Qué es GNS-AIP?

**GNS-AIP** (Agent Identity Protocol) es una capa de identidad criptográfica para agentes AI. Resuelve un problema fundamental: los agentes AI operan sin identidad demostrable, autorización humana o cumplimiento jurisdiccional.

## La Brecha de Identidad

Cada framework de agentes AI — LangChain, OpenAI, CrewAI, AutoGen, Vercel AI — te permite construir agentes que razonan, usan herramientas y ejecutan acciones. Ninguno responde:

- **¿Quién autorizó este agente?** No hay vínculo criptográfico del agente al humano.
- **¿Dónde puede operar?** Los agentes no tienen concepto de jurisdicción geográfica.
- **¿Es conforme?** Sin puntuación en tiempo real, sin rastro de auditoría, sin reportes regulatorios.

## Primitivas Fundamentales

### 1. Identidad del Agente
Cada agente recibe un **par de claves Ed25519**. La clave pública ES la identidad — sin nombres de usuario, sin contraseñas, sin API keys.

### 2. Certificados de Delegación
Un **DelegationCert** es un certificado firmado criptográficamente que vincula un agente a su principal humano.

### 3. Vinculación Territorial
Los agentes se vinculan a **celdas hexagonales H3** — una cuadrícula geoespacial jerárquica que mapea jurisdicciones reales.

### 4. Puntuación de Cumplimiento
Un **modelo de 5 niveles** (SHADOW → SOVEREIGN) evalúa agentes en validez de delegación, consistencia territorial, historial operativo y staking de tokens GNS.

## Proveniencia de Tres Capas

| Capa | Rol | Ejemplo | Artefacto GNS-AIP |
|------|-----|---------|-------------------|
| **Capa 1** | Creador | Anthropic, OpenAI | Hash de origen del modelo |
| **Capa 2** | Desplegador | Tu empresa | AgentManifest |
| **Capa 3** | Principal | Usuario humano | DelegationCert |

## Próximos Pasos

- **[Inicio Rápido](/es/guide/quickstart)** — Crea tu primer agente en 2 minutos
- **[Arquitectura](/es/guide/architecture)** — Cómo encaja el sistema
- **[Elige tu framework](/es/integrations/langchain/)** — LangChain, OpenAI, Vercel AI, CrewAI o AutoGen
