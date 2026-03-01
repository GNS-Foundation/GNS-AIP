# Catene di Delega

Una catena di delega è una sequenza di certificati firmati crittograficamente che collega un agente AI a un referente umano.

## Struttura della Catena

```
Referente Umano ──[cert 1]──> Agente Deployer ──[cert 2]──> Agente Worker
     profondità: 0              profondità: 1               profondità: 2
```

Ogni catena deve terminare a una radice umana. Le catene senza radice umana sono invalide — l'agente opera al livello SHADOW.

## Restringimento dell'Ambito

Ogni delega può solo restringere l'ambito, mai ampliarlo.
