# Delega

I certificati di delega creano una catena crittografica dal referente umano all'agente AI.

## Come Funziona

Un **DelegationCert** è un certificato firmato che dice: "Io, umano `X`, autorizzo l'agente `Y` a compiere le azioni `Z` nel territorio `T` fino al tempo `E`."

## Ambito

Ogni delega ha un **ambito** che limita cosa l'agente può fare:

```typescript
const cert = await sdk.delegateToAgent({
  principalPk: 'ed25519-pk-umano',
  agentId: agent.agentId,
  scope: {
    actions: ['search', 'code'],
    resources: ['public-data'],
  },
  territory: ['8a2a1072b59ffff'],
});
```

## Verifica della Catena

Le catene di delega possono essere percorse programmaticamente. `DelegationChain.verify()` cammina dalla catena dall'agente alla radice, verificando che ogni certificato sia valido e che la radice sia un'identità umana.

## Restringimento dell'Ambito

Ogni delega può solo restringere l'ambito, mai ampliarlo.
