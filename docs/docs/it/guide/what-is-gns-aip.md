# Cos'è GNS-AIP?

**GNS-AIP** (Agent Identity Protocol) è un livello di identità crittografica per agenti AI. Risolve un problema fondamentale: gli agenti AI operano senza identità dimostrabile, autorizzazione umana o conformità giurisdizionale.

## Il Gap dell'Identità

Ogni framework per agenti AI — LangChain, OpenAI, CrewAI, AutoGen, Vercel AI — ti permette di costruire agenti che ragionano, usano strumenti e compiono azioni. Nessuno di essi risponde a:

- **Chi ha autorizzato questo agente?** Non esiste un collegamento crittografico dall'agente all'essere umano.
- **Dove può operare?** Gli agenti non hanno alcun concetto di giurisdizione geografica.
- **È conforme?** Nessun punteggio in tempo reale, nessuna traccia di audit, nessun reporting regolamentare.

## Primitive Fondamentali

### 1. Identità Agente
Ogni agente riceve un **keypair Ed25519**. La chiave pubblica È l'identità — nessun username, nessuna password, nessuna API key.

### 2. Certificati di Delega
Un **DelegationCert** è un certificato firmato crittograficamente che collega un agente al suo referente umano. Le catene di delega possono essere percorse: Agente → Deployer → Umano.

### 3. Vincolo Territoriale
Gli agenti sono vincolati a **celle esagonali H3** — una griglia geospaziale gerarchica che mappa giurisdizioni reali.

### 4. Punteggio di Conformità
Un **modello a 5 livelli** (SHADOW → SOVEREIGN) valuta gli agenti su validità della delega, coerenza territoriale, cronologia operativa e staking di token GNS.

## Provenienza a Tre Livelli

| Livello | Ruolo | Esempio | Artefatto GNS-AIP |
|---------|-------|---------|-------------------|
| **Livello 1** | Creatore | Anthropic, OpenAI | Hash origine modello |
| **Livello 2** | Deployer | La tua azienda | AgentManifest |
| **Livello 3** | Referente | Utente umano | DelegationCert |

## Perché Non la Biometria?

WorldCoin scansiona la tua iride. GNS-AIP traccia la tua traiettoria.

**Non sei la tua iride. Sei la tua traiettoria.**

## Prossimi Passi

- **[Avvio Rapido](/it/guide/quickstart)** — Crea il tuo primo agente in 2 minuti
- **[Architettura](/it/guide/architecture)** — Come si incastra il sistema
- **[Scegli il tuo framework](/it/integrations/langchain/)** — LangChain, OpenAI, Vercel AI, CrewAI o AutoGen
