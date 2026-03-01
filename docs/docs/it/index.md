---
layout: home

hero:
  name: GNS-AIP
  text: Protocollo di Identità per Agenti
  tagline: Dai ai tuoi agenti AI identità dimostrabile, delega umana e punteggio di conformità. 5 righe di codice. Qualsiasi framework.
  actions:
    - theme: brand
      text: Avvio Rapido →
      link: /it/guide/quickstart
    - theme: alt
      text: Vedi su GitHub
      link: https://github.com/GNS-Foundation/GNS-AIP

features:
  - icon: ID
    title: Identità Agente
    details: Ogni agente AI riceve un keypair Ed25519 e un'identità crittografica. Nessuna password, nessuna API key — la chiave pubblica È l'identità.
  - icon: DC
    title: Delega Umana
    details: I certificati di delega creano una catena firmata crittograficamente dall'essere umano all'agente AI. Ogni azione risale a una persona reale.
  - icon: H3
    title: Vincolo Territoriale
    details: Le celle esagonali H3 vincolano gli agenti a giurisdizioni geografiche. Un agente sanitario EU non può operare nel territorio US senza autorizzazione esplicita.
  - icon: CS
    title: Punteggio di Conformità
    details: Modello di conformità a 5 livelli (SHADOW → SOVEREIGN) valuta gli agenti su delega, territorio, cronologia e staking. In tempo reale, verificabile.
  - icon: BC
    title: Traccia Breadcrumb
    details: Log operativi che preservano la privacy creano una traccia di audit non falsificabile. Non registra mai prompt o output — solo metadati.
  - icon: FW
    title: Qualsiasi Framework, 5 Righe
    details: Integrazioni drop-in per LangChain, OpenAI, Vercel AI, CrewAI e AutoGen. Provisioning → Delega → Via. Meno di 5 righe di codice.
---

<style>
.framework-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  margin: 32px 0;
}
.framework-card {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 24px;
  transition: border-color 0.25s, transform 0.25s;
}
.framework-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}
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

## In Numeri

<div class="stats-bar">
  <div class="stat"><div class="number">6</div><div class="label">Pacchetti SDK</div></div>
  <div class="stat"><div class="number">341</div><div class="label">Test Superati</div></div>
  <div class="stat"><div class="number">5</div><div class="label">Framework</div></div>
  <div class="stat"><div class="number">2</div><div class="label">Linguaggi</div></div>
</div>

## Il Problema

Gli agenti AI prendono decisioni, accedono a dati e compiono azioni — ma nessuno può rispondere a domande fondamentali: **Chi ha autorizzato questo agente? Quale giurisdizione lo governa? È conforme?**

## La Soluzione

GNS-AIP dà a ogni agente AI un'identità crittografica che risale a un essere umano attraverso certificati di delega. Gli agenti sono vincolati a giurisdizioni geografiche tramite celle esagonali H3. Ogni operazione produce un breadcrumb che preserva la privacy. I punteggi di conformità sono calcolati in tempo reale su cinque livelli.

**Non sei la tua iride. Sei la tua traiettoria.**
