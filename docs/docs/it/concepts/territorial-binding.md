# Vincolo Territoriale

Gli agenti sono vincolati a giurisdizioni geografiche attraverso celle esagonali H3.

## Indicizzazione Geospaziale H3

[H3](https://h3geo.org/) è il sistema di griglia esagonale gerarchica di Uber. GNS-AIP usa celle di risoluzione 10 (~15m²). Ogni cella mappa una posizione fisica e, per estensione, la giurisdizione legale che governa quella posizione.

## Mapping Giurisdizionale

```
Cella H3 "8a2a1072b59ffff"
    → Coordinate: 41.89°N, 12.49°E
    → Città: Roma, Italia
    → Giurisdizione: UE (GDPR, AI Act UE, eIDAS 2.0)
```

## Privacy

Le coordinate GPS raw non vengono mai memorizzate. Tutte le posizioni sono quantizzate in celle H3.
