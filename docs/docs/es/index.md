---
layout: home

hero:
  name: GNS-AIP
  text: Protocolo de Identidad para Agentes
  tagline: Dale a tus agentes AI identidad demostrable, delegación humana y puntuación de cumplimiento. 5 líneas de código. Cualquier framework.
  actions:
    - theme: brand
      text: Inicio Rápido →
      link: /es/guide/quickstart
    - theme: alt
      text: Ver en GitHub
      link: https://github.com/GNS-Foundation/GNS-AIP

features:
  - icon: ID
    title: Identidad del Agente
    details: Cada agente AI recibe un par de claves Ed25519 e identidad criptográfica. Sin contraseñas, sin API keys — la clave pública ES la identidad.
  - icon: DC
    title: Delegación Humana
    details: Los certificados de delegación crean una cadena firmada criptográficamente desde el humano hasta el agente AI. Cada acción se rastrea hasta una persona real.
  - icon: H3
    title: Vinculación Territorial
    details: Las celdas hexagonales H3 vinculan agentes a jurisdicciones geográficas. Un agente sanitario de la UE no puede operar en territorio de EEUU sin autorización explícita.
  - icon: CS
    title: Puntuación de Cumplimiento
    details: Modelo de cumplimiento de 5 niveles (SHADOW → SOVEREIGN) evalúa agentes en delegación, territorio, historial y staking. En tiempo real, auditable.
  - icon: BC
    title: Rastro de Breadcrumbs
    details: Registros operativos que preservan la privacidad crean un rastro de auditoría infalsificable. Nunca registra prompts ni outputs — solo metadatos.
  - icon: FW
    title: Cualquier Framework, 5 Líneas
    details: Integraciones drop-in para LangChain, OpenAI, Vercel AI, CrewAI y AutoGen. Aprovisionamiento → Delegación → Listo. Menos de 5 líneas de código.
---

<style>
.framework-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin: 32px 0; }
.framework-card { border: 1px solid var(--vp-c-divider); border-radius: 12px; padding: 24px; transition: border-color 0.25s, transform 0.25s; }
.framework-card:hover { border-color: var(--vp-c-brand-1); transform: translateY(-2px); }
.framework-card h3 { margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
.framework-card .lang { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 600; text-transform: uppercase; }
.lang-ts { background: #3178C6; color: white; }
.lang-py { background: #3776AB; color: white; }
.framework-card p { margin: 0; color: var(--vp-c-text-2); font-size: 0.9rem; }
.stats-bar { display: flex; justify-content: center; gap: 48px; margin: 48px 0; flex-wrap: wrap; }
.stat { text-align: center; }
.stat .number { font-size: 2.5rem; font-weight: 800; line-height: 1.3; padding-top: 4px; background: linear-gradient(135deg, #00D4AA, #0EA5E9); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.stat .label { font-size: 0.85rem; color: var(--vp-c-text-2); margin-top: 4px; }
</style>

## En Números

<div class="stats-bar">
  <div class="stat"><div class="number">6</div><div class="label">Paquetes SDK</div></div>
  <div class="stat"><div class="number">341</div><div class="label">Tests Pasando</div></div>
  <div class="stat"><div class="number">5</div><div class="label">Frameworks</div></div>
  <div class="stat"><div class="number">2</div><div class="label">Lenguajes</div></div>
</div>

## El Problema

Los agentes AI toman decisiones, acceden a datos y ejecutan acciones — pero nadie puede responder preguntas básicas: **¿Quién autorizó este agente? ¿Qué jurisdicción lo gobierna? ¿Es conforme?**

## La Solución

GNS-AIP le da a cada agente AI una identidad criptográfica que se remonta a un humano a través de certificados de delegación. Los agentes están vinculados a jurisdicciones geográficas mediante celdas hexagonales H3. Cada operación produce un breadcrumb que preserva la privacidad.

**No eres tu iris. Eres tu trayectoria.**
